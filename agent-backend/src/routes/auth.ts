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
import {
  upsertUserByWallet,
  signSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "../services/authService";

const router = Router();

// SIWS endpoints get a tighter IP rate limit than the global one to make
// brute-forcing nonces / pubkey harvesting unattractive.
const authLimiter = ipRateLimit({ maxRequests: 30, windowMs: 60_000, burstAllowance: 5 });

router.use(authLimiter);

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
        ErrorCodes.VALIDATION_INVALID_VALUE,
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
      throw new AppError(ErrorCodes.VALIDATION_INVALID_VALUE, { field: "wallet" });
    }
    if (typeof nonce !== "string" || nonce.length !== 64) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_VALUE, { field: "nonce" });
    }
    if (typeof signature !== "string" || signature.length < 64) {
      throw new AppError(ErrorCodes.VALIDATION_INVALID_VALUE, { field: "signature" });
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
    const token = signSessionToken(user);

    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: isProduction() ? "none" : "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS * 1000,
    });

    sendSuccess(res, {
      user: {
        id: user.id,
        wallet: user.walletPubkey,
        solName: user.solName,
        displayName: user.displayName,
      },
    });
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
    const u = req.user!;
    sendSuccess(res, {
      user: {
        id: u.id,
        wallet: u.walletPubkey,
        solName: u.solName,
        displayName: u.displayName,
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
      },
    });
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
