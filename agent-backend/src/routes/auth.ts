import { Router } from "express";
import { asyncHandler, sendSuccess, AppError, ErrorCodes } from "../errors";
import { ipRateLimit } from "../middleware/rateLimit";
import { isProduction } from "../middleware/requireProduction";
import { requireUser } from "../middleware/requireUser";
import {
  createChallenge,
  verifyChallenge,
  isValidWalletPubkey,
} from "../services/siwsService";
import { adminKeyAuth } from "../middleware/adminAuth";
import {
  upsertUserByWallet,
  createUserWithEmail,
  verifyEmailLogin,
  attachEmailToUser,
  createEmailVerification,
  confirmEmailVerification,
  forceVerifyEmail,
  getUserById,
  signSessionToken,
  UserRecord,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "../services/authService";
import {
  sendVerificationEmail,
  isValidEmail,
  normalizeEmail,
} from "../services/emailService";
import { isValidPassword } from "../utils/password";

const router = Router();

// SIWS endpoints get a tighter IP rate limit than the global one to make
// brute-forcing nonces / pubkey harvesting unattractive.
const authLimiter = ipRateLimit({ maxRequests: 30, windowMs: 60_000, burstAllowance: 5 });

router.use(authLimiter);

// A stricter limiter for the email/password + verification surface, which is a
// juicier brute-force target (credential stuffing, code guessing).
const emailAuthLimiter = ipRateLimit({ maxRequests: 12, windowMs: 60_000, burstAllowance: 3 });

/** Shape a UserRecord into the public JSON we return to clients. */
function publicUser(u: UserRecord) {
  return {
    id: u.id,
    wallet: u.walletPubkey,
    solName: u.solName,
    displayName: u.displayName,
    email: u.email,
    emailVerified: !!u.emailVerifiedAt,
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt,
  };
}

/** Set the HttpOnly session cookie for a freshly authenticated user. */
function setSessionCookie(res: Parameters<typeof sendSuccess>[0], user: UserRecord) {
  const token = signSessionToken(user);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? "none" : "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

/**
 * Best-effort: issue a verification code and email it. Email delivery failures
 * are swallowed so a flaky mail provider can't block registration — the user
 * can re-request a code via /email/send-code. Returns whether the email sent.
 */
async function issueVerification(user: UserRecord): Promise<boolean> {
  const challenge = await createEmailVerification(user);
  try {
    await sendVerificationEmail(challenge.email, challenge.code, challenge.ttlMinutes);
    return true;
  } catch (err) {
    console.error("[auth] verification email failed to send:", err);
    return false;
  }
}

/**
 * POST /v1/auth/challenge
 *   { wallet: <base58 pubkey> }
 *
 * Returns a SIWS message string for the wallet to sign, plus the nonce.
 * The exact message bytes are persisted server-side; we don't trust the
 * client to send them back unmodified.
 */
router.post(
  "/challenge",
  asyncHandler(async (req, res) => {
    const { wallet } = req.body ?? {};
    if (!isValidWalletPubkey(wallet)) {
      throw new AppError(
        ErrorCodes.VALIDATION_INVALID_FORMAT,
        { field: "wallet" },
        "wallet must be a base58-encoded Solana public key (32 bytes)"
      );
    }

    const challenge = await createChallenge(wallet);
    sendSuccess(res, challenge);
  })
);

/**
 * POST /v1/auth/verify
 *   { wallet, nonce, signature }
 *
 * Verifies the ed25519 signature over the stored message. On success,
 * upserts the user, sets the HttpOnly session cookie, and returns the
 * user record.
 */
router.post(
  "/verify",
  asyncHandler(async (req, res) => {
    const { wallet, nonce, signature } = req.body ?? {};
    if (!isValidWalletPubkey(wallet)) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_FORMAT, { field: "wallet" });
    }
    if (typeof nonce !== "string" || nonce.length !== 64) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_FORMAT, { field: "nonce" });
    }
    if (typeof signature !== "string" || signature.length < 64) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_FORMAT, { field: "signature" });
    }

    const result = await verifyChallenge({ wallet, nonce, signature });
    if (!result.ok) {
      // Map internal reasons to a stable client-facing code without leaking
      // which check failed (mild brute-force resistance).
      throw new AppError(
        ErrorCodes.AUTH_INVALID_API_KEY,
        { reason: result.reason },
        "Signature verification failed"
      );
    }

    const user = await upsertUserByWallet(result.wallet);
    setSessionCookie(res, user);
    sendSuccess(res, { user: publicUser(user) });
  })
);

/**
 * GET /v1/auth/me
 *
 * Returns the current user, or 401 if not signed in. Useful for the
 * dashboard's auth bootstrap on page load.
 */
router.get(
  "/me",
  requireUser,
  asyncHandler(async (req, res) => {
    sendSuccess(res, { user: publicUser(req.user!) });
  })
);

// ===========================================================================
// EMAIL / PASSWORD LOGIN + EMAIL VERIFICATION (KYC)
// ===========================================================================

/**
 * POST /v1/auth/register
 *   { email, password }
 *
 * Creates an email/password account, signs the user in, and emails a
 * verification code. The account is usable immediately for browsing, but
 * sensitive actions stay gated until the email is verified (see
 * requireVerifiedEmail).
 */
router.post(
  "/register",
  emailAuthLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!isValidEmail(email)) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_FORMAT, { field: "email" });
    }
    if (!isValidPassword(password)) {
      throw new AppError(
        ErrorCodes.VALIDATION_INVALID_FORMAT,
        { field: "password" },
        "Password must be between 8 and 200 characters"
      );
    }

    let user: UserRecord;
    try {
      user = await createUserWithEmail(email, password);
    } catch (err: any) {
      if (err?.message === "EMAIL_TAKEN") {
        throw new AppError(ErrorCodes.AUTH_EMAIL_ALREADY_REGISTERED, { email: normalizeEmail(email) });
      }
      throw err;
    }

    const emailSent = await issueVerification(user);
    setSessionCookie(res, user);
    sendSuccess(res, { user: publicUser(user), verificationEmailSent: emailSent }, 201);
  })
);

/**
 * POST /v1/auth/login
 *   { email, password }
 *
 * Email/password login. Returns a stable AUTH_INVALID_CREDENTIALS on any
 * failure so we don't reveal whether the email exists.
 */
router.post(
  "/login",
  emailAuthLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      throw new AppError(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    const user = await verifyEmailLogin(email, password);
    if (!user) {
      throw new AppError(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    setSessionCookie(res, user);
    sendSuccess(res, { user: publicUser(user) });
  })
);

/**
 * POST /v1/auth/email/attach
 *   { email, password }   (requires an active session)
 *
 * Lets a signed-in (e.g. wallet) user add an email + password to their
 * account as a KYC contact. The email starts unverified.
 */
router.post(
  "/email/attach",
  emailAuthLimiter,
  requireUser,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!isValidEmail(email)) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_FORMAT, { field: "email" });
    }
    if (!isValidPassword(password)) {
      throw new AppError(
        ErrorCodes.VALIDATION_INVALID_FORMAT,
        { field: "password" },
        "Password must be between 8 and 200 characters"
      );
    }

    let user: UserRecord;
    try {
      user = await attachEmailToUser(req.user!.id, email, password);
    } catch (err: any) {
      if (err?.message === "EMAIL_TAKEN") {
        throw new AppError(ErrorCodes.AUTH_EMAIL_ALREADY_REGISTERED, { email: normalizeEmail(email) });
      }
      throw err;
    }

    const emailSent = await issueVerification(user);
    sendSuccess(res, { user: publicUser(user), verificationEmailSent: emailSent });
  })
);

/**
 * POST /v1/auth/email/send-code   (requires an active session)
 *
 * (Re)issues a verification code to the account's email. Used for resends and
 * when a verification email failed to deliver on register.
 */
router.post(
  "/email/send-code",
  emailAuthLimiter,
  requireUser,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (!user.email) {
      throw new AppError(ErrorCodes.AUTH_NO_EMAIL_ON_ACCOUNT);
    }
    if (user.emailVerifiedAt) {
      throw new AppError(ErrorCodes.AUTH_EMAIL_ALREADY_VERIFIED);
    }

    const emailSent = await issueVerification(user);
    sendSuccess(res, { sent: emailSent, email: user.email });
  })
);

/**
 * POST /v1/auth/email/verify
 *   { code }   (requires an active session)
 *
 * Confirms the 6-digit code and marks the account's email verified.
 */
router.post(
  "/email/verify",
  emailAuthLimiter,
  requireUser,
  asyncHandler(async (req, res) => {
    const { code } = req.body ?? {};
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_FORMAT, { field: "code" }, "code must be 6 digits");
    }

    const result = await confirmEmailVerification(req.user!.id, code);
    if (!result.ok) {
      const errCode =
        result.reason === "expired"
          ? ErrorCodes.AUTH_VERIFICATION_EXPIRED
          : ErrorCodes.AUTH_VERIFICATION_INVALID;
      throw new AppError(errCode, { reason: result.reason });
    }

    // Refresh the session cookie so the JWT reflects the now-verified user
    // (harmless, but keeps things tidy if we ever cache flags in the token).
    setSessionCookie(res, result.user);
    sendSuccess(res, { user: publicUser(result.user) });
  })
);

/**
 * POST /v1/auth/admin/verify-email
 *   { email }        header: X-Admin-Key: <ADMIN_API_KEY>
 *
 * Marks an account's email verified without sending a code. Operator escape
 * hatch: pre-seed a demo account, or rescue a user when mail delivery is down.
 *
 * Admin-key gated (adminKeyAuth denies everything when ADMIN_API_KEY is unset),
 * and never touches the user's own session — it only flips the KYC flag.
 */
router.post(
  "/admin/verify-email",
  adminKeyAuth,
  asyncHandler(async (req, res) => {
    const { email } = req.body ?? {};
    if (!isValidEmail(email)) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_FORMAT, { field: "email" });
    }

    const user = await forceVerifyEmail(email);
    if (!user) {
      throw new AppError(
        ErrorCodes.AGENT_NOT_FOUND,
        { email: normalizeEmail(email) },
        "No account with that email"
      );
    }

    console.warn(
      `[KYC] admin force-verified ${user.email} (user ${user.id}) via X-Admin-Key`
    );
    sendSuccess(res, { user: publicUser(user) });
  })
);

/**
 * POST /v1/auth/logout
 *
 * Clears the session cookie. Doesn't blacklist the JWT — for v1 we accept
 * that a logged-out token is valid until expiry (24h). Acceptable risk
 * given the short TTL; revisit if longer sessions are introduced.
 */
router.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: isProduction() ? "none" : "lax",
      path: "/",
    });
    sendSuccess(res, { ok: true });
  })
);

export default router;
