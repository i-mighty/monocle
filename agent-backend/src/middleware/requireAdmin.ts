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
 * Two ways in, for two different callers:
 *
 *   X-Admin-Key   a machine (a cron, a script, an internal service). Fails
 *                 closed when ADMIN_API_KEY is unset, which it currently is in
 *                 production, so this path grants nothing until it is set.
 *
 *   session       a person, using the account they already sign in with, whose
 *                 users.is_admin is true.
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
  SESSION_COOKIE_NAME,
  getUserById,
  verifySessionToken,
} from "../services/authService";

function deny(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message } });
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
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

  const user = await getUserById(payload.sub);
  if (!user) {
    return deny(res, 401, "AUTH_USER_NOT_FOUND", "Account no longer exists");
  }

  if (!user.isAdmin) {
    // Logged, because an ordinary user reaching an operator route is either a
    // misrouted UI or somebody trying paths — both worth seeing.
    console.warn(`[admin] denied ${req.method} ${req.path} for ${user.email ?? user.id}`);
    return deny(
      res,
      403,
      "AUTH_INSUFFICIENT_PERMISSIONS",
      "This is a Monocle operator view. Your account does not have access."
    );
  }

  req.user = user;
  return next();
}
