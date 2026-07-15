/**
 * Email-verification (KYC) gates for sensitive actions.
 *
 * Two flavours:
 *
 *  - requireVerifiedEmail: hard gate. Must have a valid session AND a verified
 *    email. Use on routes that are exclusively for signed-in dashboard users.
 *
 *  - gateSensitiveActionByEmail: dual-audience gate for endpoints that today
 *    authenticate with an API key (the SDK / machine boundary) but are ALSO
 *    reachable from the dashboard with a user session cookie:
 *
 *      • valid session + verified email   → next()  (human, KYC-passed)
 *      • valid session + unverified email → 403 AUTH_EMAIL_NOT_VERIFIED
 *      • cookie present but INVALID       → 401  (see note below)
 *      • no cookie at all                 → next()  (fall through to apiKeyAuth;
 *                                             the pure SDK path is unchanged)
 *
 *    Mount it BEFORE apiKeyAuth on the route so the API key is still required:
 *      router.post("/settle/:id", gateSensitiveActionByEmail, apiKeyAuth, handler)
 *
 *    Why reject a present-but-invalid cookie instead of ignoring it: the
 *    dashboard proxy injects the platform API key server-side, so if we let a
 *    junk cookie fall through, a browser user could forge any cookie value and
 *    ride the injected key straight past the KYC check. Presenting a session
 *    means it must be a valid one. Real SDK callers send no cookie and are
 *    unaffected.
 *
 *    The "no cookie" case is closed at the dashboard boundary instead: the
 *    proxy (pages/api/proxy) refuses sensitive paths without a session cookie,
 *    so a browser can't reach these routes on the injected key alone.
 */

import { Request, Response, NextFunction } from "express";
import { AppError, ErrorCodes } from "../errors";
import {
  SESSION_COOKIE_NAME,
  getUserById,
  verifySessionToken,
} from "../services/authService";

function kycError(): AppError {
  return new AppError(
    ErrorCodes.AUTH_EMAIL_NOT_VERIFIED,
    { action: "verify_email" },
    "Verify your email to perform this action"
  );
}

/**
 * Hard gate: requires a signed-in user whose email is verified. Attaches the
 * user to req.user on success (so it can stand in for requireUser).
 */
export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof token !== "string") {
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

  if (!user.emailVerifiedAt) {
    const err = kycError();
    return res.status(err.httpStatus).json(err.toResponse((req as any).requestId));
  }

  req.user = user;
  return next();
}

/**
 * Session-aware gate for API-key routes. See file header for the truth table.
 * Only blocks when a valid session exists with an unverified email; otherwise
 * calls next() and lets the downstream apiKeyAuth do its job.
 */
export async function gateSensitiveActionByEmail(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof token !== "string") return next(); // pure SDK / API-key path

  // From here on a session was presented, so it has to be a real one — we
  // never fall back to the API key once a cookie is in play.
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

  // A real human session is present — enforce KYC.
  req.user = user;
  if (!user.emailVerifiedAt) {
    const err = kycError();
    return res.status(err.httpStatus).json(err.toResponse((req as any).requestId));
  }

  return next();
}
