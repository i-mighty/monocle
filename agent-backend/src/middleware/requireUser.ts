/**
 * requireUser — gate routes behind a valid SIWS session cookie.
 *
 * Reads the monocle_session cookie, verifies the JWT, loads the user from
 * the DB, and attaches it to req.user. Responds 401 if any step fails.
 *
 * Use on routes meant for end users of the dashboard. SDK / agent-builder
 * routes should keep apiKeyAuth — different audience, different boundary.
 */

import { Request, Response, NextFunction } from "express";
import {
  SESSION_COOKIE_NAME,
  UserRecord,
  getUserById,
  verifySessionToken,
} from "../services/authService";

declare global {
  namespace Express {
    interface Request {
      user?: UserRecord;
    }
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token || typeof token !== "string") {
    return res.status(401).json({
      success: false,
      error: { code: "AUTH_NOT_SIGNED_IN", message: "Sign in to continue" },
    });
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    return res.status(401).json({
      success: false,
      error: { code: "AUTH_INVALID_SESSION", message: "Session expired or invalid" },
    });
  }

  const user = await getUserById(payload.sub);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: { code: "AUTH_USER_NOT_FOUND", message: "Account no longer exists" },
    });
  }

  req.user = user;
  return next();
}

/**
 * optionalUser — same as requireUser, but doesn't reject if there's no
 * session. Use on routes that have public + signed-in variants
 * (e.g. marketplace listings that show extra info to logged-in users).
 */
export async function optionalUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof token !== "string") return next();

  const payload = verifySessionToken(token);
  if (!payload) return next();

  const user = await getUserById(payload.sub);
  if (user) req.user = user;
  return next();
}
