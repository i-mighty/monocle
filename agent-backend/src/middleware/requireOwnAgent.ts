/**
 * requireOwnAgent — bind a money operation to the agent its API key names.
 *
 * The problem this solves: there was one working credential, the platform key,
 * and it authenticates as "the platform" rather than as anybody in particular.
 * `callerId` / `:agentId` were therefore unverified claims in the request, so any
 * key holder could bill any agent, settle any agent, or withdraw any agent's
 * balance. The dashboard even instructed users to paste that key in, which made
 * every user a key holder.
 *
 * The rule here: a request that moves money must present a key that names an
 * agent, and may only act as that agent. Then a key holder can only ever spend
 * their own balance and pay their own wallet — which is not theft, it is just
 * using their account.
 *
 * A platform/developer key has agentId === null. That is deliberately NOT treated
 * as "may act as any agent": it is rejected, because a credential that names
 * nobody cannot be authorised to move somebody's money. Operator tasks that
 * legitimately act across agents (the settlement scheduler) run in-process and
 * never traverse this middleware.
 *
 * Usage — mount AFTER apiKeyAuth, naming where the target agent id is found:
 *   router.post("/settle/:agentId", apiKeyAuth, requireOwnAgent("params.agentId"), h)
 *   router.post("/execute", apiKeyAuth, requireOwnAgent("body.callerId"), h)
 */

import { Request, Response, NextFunction } from "express";
import { AppError, ErrorCodes } from "../errors";
import { query } from "../db/client";

type Source = `params.${string}` | `body.${string}`;

function readClaim(req: Request, source: Source): unknown {
  const [where, ...rest] = source.split(".");
  const field = rest.join(".");
  const bag = where === "params" ? req.params : (req.body ?? {});
  return (bag as Record<string, unknown>)?.[field];
}

/**
 * @param source where the target agent id lives, e.g. "params.agentId" or
 *               "body.callerId" — the value the caller is *claiming* to be.
 */
/**
 * Same rule, but a signed-in owner may also act as their own agent.
 *
 * An agent key cannot be injected on the caller's behalf: only its sha256 digest
 * is stored, so no plaintext exists server-side to forward. The equivalent is to
 * accept proven ownership as standing in for the key — the owner is, after all,
 * the person entitled to move that agent's money.
 *
 * Two ways in, and nothing else:
 *
 *   1. a session whose user owns the named agent, or
 *   2. an agent-scoped key naming it (unchanged, and the only path for SDK
 *      callers, which have no session).
 *
 * Neither widens who may act as somebody else's agent. What it widens is how the
 * rightful owner proves it, which is what lets the dashboard settle and withdraw
 * without putting an agent key in a browser.
 *
 * Two things carry the safety of path 1. The session cookie is SameSite=Lax, so
 * a cross-site POST does not carry it and cannot spend on the user's behalf. And
 * mounting gateSensitiveActionByEmail ahead of this means a session with an
 * unverified email is refused before it gets here — the same KYC bar settle and
 * withdraw already enforce.
 */
export function requireOwnAgentOrOwner(source: Source) {
  return async function requireOwnAgentOrOwnerMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const claimed = readClaim(req, source);

    // Who is claiming to own this? A browser session, or a developer key, which
    // names a user even though it names no agent.
    //
    // The developer key matters for parity: the documented API path is `Mon_...`
    // in an x-api-key header, and without this an owner could edit their agent
    // from the dashboard but not from the SDK the README tells them to use. It
    // widens nothing — the key still has to belong to the account that owns the
    // named agent.
    const claimant = req.user
      ? { id: req.user.id, email: req.user.email ?? null }
      : req.apiKeyRecord?.userId
      ? { id: req.apiKeyRecord.userId, email: null }
      : null;

    if (claimant && typeof claimed === "string" && claimed.length > 0) {
      try {
        const owned = await query(
          `select 1
             from agents
            where id = $1
              and (owner_user_id = $2
                   or ($3::text is not null and lower(owner_email) = lower($3)))
            limit 1`,
          [claimed, claimant.id, claimant.email]
        );
        if (owned.rows.length > 0) return next();
      } catch (err) {
        // A failed ownership lookup must not fall through to "allowed". Drop to
        // the key path, which authorises on its own evidence.
        console.error("[requireOwnAgentOrOwner] ownership lookup failed:", err);
      }
    }

    // We know who this is, and they do not own the agent. Falling through to the
    // key path would answer 401 "authentication required", which is wrong and
    // actively unhelpful: they ARE authenticated, and a client seeing 401 will
    // send them to sign in again, which cannot possibly help. Say 403 — unless
    // they also presented an agent-scoped key, which is a separate claim and
    // deserves to be judged on its own.
    if (claimant && !req.apiKeyRecord?.agentId) {
      const err = new AppError(
        ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS,
        { agentId: typeof claimed === "string" ? claimed : undefined },
        "You can only do this to an agent you own."
      );
      return res.status(err.httpStatus).json(err.toResponse((req as any).requestId));
    }

    return requireOwnAgent(source)(req, res, next);
  };
}

export function requireOwnAgent(source: Source) {
  return function requireOwnAgentMiddleware(req: Request, res: Response, next: NextFunction) {
    const record = req.apiKeyRecord;

    // No authenticated key at all — apiKeyAuth should have caught this, but a
    // money route must never proceed on the assumption that it did.
    if (!record) {
      const err = new AppError(
        ErrorCodes.AUTH_UNAUTHORIZED,
        undefined,
        "Authentication required"
      );
      return res.status(err.httpStatus).json(err.toResponse((req as any).requestId));
    }

    const actingAs = record.agentId;

    // A key that names no agent (platform / developer key) cannot move an agent's
    // money on its behalf. This is the check that closes the shared-key hole.
    if (!actingAs) {
      const err = new AppError(
        ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS,
        { reason: "key_not_agent_scoped" },
        "This action requires an agent's own API key. The platform key is not " +
          "scoped to an agent and cannot move an agent's funds."
      );
      return res.status(err.httpStatus).json(err.toResponse((req as any).requestId));
    }

    const claimed = readClaim(req, source);
    if (typeof claimed !== "string" || claimed.length === 0) {
      const err = new AppError(
        ErrorCodes.VALIDATION_REQUIRED_FIELD,
        { field: source },
        `${source} is required`
      );
      return res.status(err.httpStatus).json(err.toResponse((req as any).requestId));
    }

    if (claimed !== actingAs) {
      const err = new AppError(
        ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS,
        { reason: "agent_mismatch", actingAs, requested: claimed },
        "Your API key can only act for its own agent."
      );
      return res.status(err.httpStatus).json(err.toResponse((req as any).requestId));
    }

    return next();
  };
}
