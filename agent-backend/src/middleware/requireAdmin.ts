/**
 * requireAdmin — gate routes that expose every user's data, not just the
 * caller's own.
 *
 * Platform analytics are the clearest example: revenue, failure logs, per-agent
 * spend, leaderboards. Those answer "how is Monocle doing", which is an operator
 * question. They were mounted with no authentication at all — analytics.ts
 * imported apiKeyAuth and never applied it — so the whole set was readable by
 * anyone who guessed the path.
 *
 * Operators are graded (see ADMIN_ROLES): viewer < admin < owner. Pass the
 * minimum level a route needs:
 *
 *   router.get("/agents",    requireAdmin("viewer"), ...)  operations
 *   router.get("/revenue",   requireAdmin("admin"),  ...)  money
 *   router.put("/operators", requireAdmin("owner"),  ...)  handing out access
 *
 * The default is "admin" rather than "viewer", so a route mounted without
 * thinking about its level gets the stricter treatment. Under-exposing is a bug
 * report; over-exposing is an incident.
 *
 * Two ways in, for two different callers:
 *
 *   X-Admin-Key   a machine (a cron, a script, an internal service). Fails
 *                 closed when ADMIN_API_KEY is unset, which it currently is in
 *                 production, so this path grants nothing until it is set. Acts
 *                 at owner level — it is the platform's own key.
 *
 *   session       a person, using the account they already sign in with, whose
 *                 users.admin_role meets the bar.
 *
 * Deliberately NOT accepting a plain API key. A `Mon_` developer key identifies
 * a developer, and every developer has one — treating it as sufficient here
 * would hand every signed-up user the platform's books. The key boundary and the
 * operator boundary are different questions and the answer to one is not the
 * answer to the other.
 *
 * 401 when we do not know who you are, 403 when we do and it is not enough. The
 * distinction matters to a client deciding whether to show a login prompt or an
 * error.
 */

import { Request, Response, NextFunction } from "express";
import { hasValidAdminKey } from "./adminAuth";
import {
  AdminRole,
  SESSION_COOKIE_NAME,
  getUserById,
  hasAdminLevel,
  verifySessionToken,
} from "../services/authService";

function deny(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message } });
}

/** Human phrasing for the refusal, so the UI does not have to invent one. */
function describe(required: AdminRole): string {
  switch (required) {
    case "owner":
      return "Only an owner can do this.";
    case "admin":
      return "This shows platform financials and is limited to admins.";
    default:
      return "This is a Monocle operator view. Your account does not have access.";
  }
}

export function requireAdmin(required: AdminRole = "admin") {
  return async function requireAdminLevel(req: Request, res: Response, next: NextFunction) {
    // Machine path. Checked first so an operator script never needs a browser
    // session, and so a stray cookie on a server-side caller cannot shadow it.
    if (req.headers["x-admin-key"]) {
      if (hasValidAdminKey(req)) return next();
      return deny(res, 403, "AUTH_INSUFFICIENT_PERMISSIONS", "Invalid admin key");
    }

    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof token !== "string") {
      return deny(res, 401, "AUTH_NOT_SIGNED_IN", "Sign in to continue");
    }

    const payload = verifySessionToken(token);
    if (!payload) {
      return deny(res, 401, "AUTH_INVALID_SESSION", "Session expired or invalid");
    }

    // Read live rather than trusting the token: a role carried in a signed
    // session would keep working until the session expired, which for a 24-hour
    // token is not revocation in any useful sense.
    const user = await getUserById(payload.sub);
    if (!user) {
      return deny(res, 401, "AUTH_USER_NOT_FOUND", "Account no longer exists");
    }

    if (!hasAdminLevel(user.adminRole, required)) {
      // Logged, because an ordinary user reaching an operator route is either a
      // misrouted UI or somebody trying paths — both worth seeing.
      console.warn(
        `[admin] denied ${req.method} ${req.path} for ${user.email ?? user.id} ` +
          `(has ${user.adminRole ?? "none"}, needs ${required})`
      );
      return deny(res, 403, "AUTH_INSUFFICIENT_PERMISSIONS", describe(required));
    }

    req.user = user;
    return next();
  };
}
