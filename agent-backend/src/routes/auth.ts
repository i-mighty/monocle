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
  consumeStepUpCode,
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
import {
  createDeveloperKey,
  getDeveloperKeyMetadata,
  regenerateDeveloperKey,
} from "../services/securityService";
import { requireVerifiedEmail } from "../middleware/requireVerifiedEmail";
import { query } from "../db/client";
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
    // The dashboard uses this to decide whether to offer the operator views. It
    // is a hint for rendering, not a gate — requireAdmin on the backend is the
    // gate, and it re-reads the flag rather than trusting anything the client
    // sends back.
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt,
  };
}

/**
 * Set the HttpOnly session cookie for a freshly authenticated user.
 *
 * SameSite=Lax, not None.
 *
 * The session only ever travels first-party: the browser talks to the dashboard's
 * own origin and pages/api/proxy forwards to the backend server-side, so the
 * cookie is never legitimately sent cross-site. `None` was needed back when the
 * browser called the backend directly, and it survived the move to the proxy.
 *
 * Leaving it as None is not merely redundant, it is fragile. None declares the
 * cookie available in cross-site contexts, which is exactly the category
 * browsers are restricting: third-party cookie blocking, storage partitioning,
 * Safari ITP and Brave's shields all treat such cookies as suspect. A session
 * that curl keeps happily can therefore be dropped by a real browser, which
 * looks like being bounced back to the login page immediately after signing in.
 *
 * Lax still accompanies top-level navigation to /dashboard, which is precisely
 * the case that was failing.
 */
function setSessionCookie(res: Parameters<typeof sendSuccess>[0], user: UserRecord) {
  const token = signSessionToken(user);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

/**
 * Best-effort: issue a verification code and email it. Email delivery failures
 * are swallowed so a flaky mail provider can't block registration - the user
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
 * Mint the developer's API key the first time their email is verified.
 *
 * Returns the plaintext key to be shown exactly once, or null if they already
 * have one — re-verifying must not mint a second key, and cannot return the
 * existing one, which is stored only as a digest.
 *
 * Best-effort by design. The email is already marked verified by the time we get
 * here, so throwing would leave the user verified but staring at an error, and a
 * retry would be refused as already-verified. A missing key is recoverable
 * through the regenerate flow; a failed verification is not. Failures are logged
 * loudly rather than surfaced.
 */
async function issueDeveloperKeyOnce(userId: string): Promise<string | null> {
  try {
    const existing = await getDeveloperKeyMetadata(userId);
    if (existing) return null;

    const { plainKey } = await createDeveloperKey({ userId });
    return plainKey;
  } catch (err: any) {
    // The partial unique index (migration 0003) is the backstop against two
    // concurrent verifications both passing the check above. Losing that race
    // is correct behaviour, not an error: the user has a key, it just isn't
    // this request's to show.
    if (err?.code === "23505") {
      console.warn(`[auth] developer key already issued for user ${userId} (concurrent verify)`);
      return null;
    }
    console.error("[auth] failed to issue developer key:", err?.message ?? err);
    return null;
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

    const verificationEmailSent = user.emailVerifiedAt ? undefined : await issueVerification(user);

    setSessionCookie(res, user);
    sendSuccess(res, { user: publicUser(user), verificationEmailSent });
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

    // Verification just succeeded, so this is where the developer gets their key
    // — not at registration, which would let unverified signups consume key
    // records. `apiKey` is present in this response and in no other: it is the
    // only moment the plaintext exists outside the caller's hands.
    const apiKey = await issueDeveloperKeyOnce(result.user.id);

    // Refresh the session cookie so the JWT reflects the now-verified user
    // (harmless, but keeps things tidy if we ever cache flags in the token).
    setSessionCookie(res, result.user);
    sendSuccess(res, { user: publicUser(result.user), apiKey });
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
 * and never touches the user's own session - it only flips the KYC flag.
 *
 * Deliberately does NOT mint the user's developer key. The plaintext is returned
 * exactly once to whoever calls the endpoint, and here that is an operator, not
 * the developer - handing a user's credential to an operator is precisely the
 * mixing of credential types this design keeps apart. The user picks their key up
 * through the regenerate flow instead.
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
 * POST /v1/auth/admin/role   (X-Admin-Key)
 *
 * Grant or revoke operator access: { email, isAdmin }.
 *
 * Gated by the machine key rather than by an existing admin, so the first
 * operator can be created at all — an admin-only grant endpoint cannot mint the
 * admin it requires. Once ADMIN_API_KEY is set, this is the ordinary way to add
 * and remove operators; before that, scripts/grant-admin.js does the same thing
 * against the database directly, which is how the first one gets made.
 *
 * Revocation goes through the same door on purpose. A grant path without a
 * matching revoke path means the only way to remove an operator is SQL, and
 * that is the moment you need it to be easy.
 */
router.post(
  "/admin/role",
  adminKeyAuth,
  asyncHandler(async (req, res) => {
    const { email, isAdmin } = req.body ?? {};
    if (!isValidEmail(email)) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_FORMAT, { field: "email" });
    }
    if (typeof isAdmin !== "boolean") {
      throw new AppError(
        ErrorCodes.VALIDATION_INVALID_FORMAT,
        { field: "isAdmin" },
        "isAdmin must be true or false — say which, rather than toggling blind"
      );
    }

    const result = await query(
      `update users set is_admin = $2 where lower(email) = lower($1) returning id, email`,
      [normalizeEmail(email), isAdmin]
    );
    if (result.rows.length === 0) {
      throw new AppError(
        ErrorCodes.AGENT_NOT_FOUND,
        { email: normalizeEmail(email) },
        "No account with that email"
      );
    }

    // Loud: this is the change that lets somebody see everyone else's data.
    console.warn(
      `[admin] ${isAdmin ? "GRANTED" : "REVOKED"} operator access for ` +
        `${result.rows[0].email} (user ${result.rows[0].id}) via X-Admin-Key`
    );
    sendSuccess(res, { email: result.rows[0].email, isAdmin });
  })
);

// ===========================================================================
// DEVELOPER API KEY (`Mon_...`)
//
// Three endpoints, one invariant: the plaintext key exists in exactly one
// response body in this file — the regenerate one — and nowhere else, ever. It
// is stored as a digest, so there is no reveal endpoint and there cannot be one.
// ===========================================================================

/**
 * How long a developer must wait between step-up code requests, and how many
 * they may request per hour.
 *
 * This endpoint sends mail on demand to an address an attacker does not control
 * but the account owner does, so it is both a spam vector aimed at the user's
 * inbox and a way to burn through the mail provider's quota. The IP limiter that
 * already covers this router does not stop either on its own: a single signed-in
 * session can sit under the IP limit and still fire a request every second.
 *
 * Enforced from email_verifications rather than an in-memory counter, so the
 * limit survives a restart and holds if the backend is ever run as more than one
 * process — an in-memory bucket would reset on deploy and be trivially outlasted.
 */
const STEP_UP_COOLDOWN_SECONDS = 60;
const STEP_UP_MAX_PER_HOUR = 5;

/**
 * GET /v1/auth/api-key   (requires an active session)
 *
 * Metadata for the caller's developer key, or null if they have none. Never
 * returns the key or its hash: the key is stored one-way and this endpoint is
 * how the dashboard knows a key exists without being able to show it.
 */
router.get(
  "/api-key",
  requireUser,
  asyncHandler(async (req, res) => {
    const key = await getDeveloperKeyMetadata(req.user!.id);
    sendSuccess(res, { key });
  })
);

/**
 * POST /v1/auth/api-key/regenerate/send-code   (requires a verified email)
 *
 * Emails a fresh 6-digit code scoped to 'regenerate_api_key'. Reuses the signup
 * verification machinery rather than a parallel one, so the code shares its
 * expiry, attempt ceiling and hashed storage — but is not interchangeable with a
 * signup code in either direction (see consumeStepUpCode).
 */
router.post(
  "/api-key/regenerate/send-code",
  emailAuthLimiter,
  requireVerifiedEmail,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (!user.email) {
      throw new AppError(ErrorCodes.AUTH_NO_EMAIL_ON_ACCOUNT);
    }

    const recent = await query(
      `select
         max(created_at) as last_sent,
         count(*) filter (where created_at > now() - interval '1 hour') as sent_last_hour
       from email_verifications
       where user_id = $1 and purpose = 'regenerate_api_key'`,
      [user.id]
    );
    const lastSent: Date | null = recent.rows[0]?.last_sent ?? null;
    const sentLastHour = Number(recent.rows[0]?.sent_last_hour ?? 0);

    if (lastSent) {
      const elapsedSeconds = (Date.now() - new Date(lastSent).getTime()) / 1000;
      if (elapsedSeconds < STEP_UP_COOLDOWN_SECONDS) {
        const retryAfter = Math.ceil(STEP_UP_COOLDOWN_SECONDS - elapsedSeconds);
        res.setHeader("Retry-After", retryAfter);
        throw new AppError(
          ErrorCodes.RATE_LIMIT_EXCEEDED,
          { retryAfter, reason: "cooldown" },
          `Wait ${retryAfter}s before requesting another code.`
        );
      }
    }

    if (sentLastHour >= STEP_UP_MAX_PER_HOUR) {
      res.setHeader("Retry-After", 3600);
      throw new AppError(
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        { retryAfter: 3600, reason: "hourly_cap" },
        "Too many code requests. Try again later."
      );
    }

    const challenge = await createEmailVerification(user, "regenerate_api_key");
    let sent = true;
    try {
      await sendVerificationEmail(challenge.email, challenge.code, challenge.ttlMinutes);
    } catch (err) {
      console.error("[auth] step-up email failed to send:", err);
      sent = false;
    }

    sendSuccess(res, { sent, email: user.email, expiresAt: challenge.expiresAt });
  })
);

/**
 * POST /v1/auth/api-key/regenerate
 *   { code }   (requires a verified email)
 *
 * Invalidates the caller's current key and issues a new one, returning the
 * plaintext exactly once. This is the "Regenerate" the dashboard offers in place
 * of a "Reveal" that cannot exist.
 *
 * The code is consumed BEFORE the key is replaced, so a replayed request fails on
 * the spent code rather than minting a second key. If the replacement then fails,
 * it rolls back whole (see regenerateDeveloperKey) and the caller keeps their old
 * working key, having lost only the code.
 */
router.post(
  "/api-key/regenerate",
  emailAuthLimiter,
  requireVerifiedEmail,
  asyncHandler(async (req, res) => {
    const { code } = req.body ?? {};
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_FORMAT, { field: "code" }, "code must be 6 digits");
    }

    const consumed = await consumeStepUpCode(req.user!.id, code, "regenerate_api_key");
    if (!consumed.ok) {
      const errCode =
        consumed.reason === "expired"
          ? ErrorCodes.AUTH_VERIFICATION_EXPIRED
          : ErrorCodes.AUTH_VERIFICATION_INVALID;
      throw new AppError(errCode, { reason: consumed.reason });
    }

    const { plainKey, revokedCount } = await regenerateDeveloperKey({ userId: req.user!.id });

    console.warn(
      `[auth] developer key regenerated for user ${req.user!.id} (${revokedCount} revoked)`
    );
    sendSuccess(res, { apiKey: plainKey, revokedCount });
  })
);

/**
 * POST /v1/auth/logout
 *
 * Clears the session cookie. Doesn't blacklist the JWT - for v1 we accept
 * that a logged-out token is valid until expiry (24h). Acceptable risk
 * given the short TTL; revisit if longer sessions are introduced.
 */
router.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    // Attributes must match setSessionCookie exactly — a browser only clears a
    // cookie when they line up, so a mismatch here leaves the session in place
    // and logout silently does nothing.
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: "lax",
      path: "/",
    });
    sendSuccess(res, { ok: true });
  })
);

export default router;
