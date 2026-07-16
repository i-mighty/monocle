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
