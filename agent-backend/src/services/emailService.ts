/**
 * Transactional email delivery via Resend (https://resend.com).
 *
 * Uses Resend's REST API over Node's global fetch — no SDK dependency. Config
 * comes from env:
 *   RESEND_API_KEY   required. API key from the Resend dashboard.
 *   EMAIL_FROM       required. Verified sender, e.g. "Monocle <noreply@yourdomain.com>".
 *   EMAIL_REPLY_TO   optional. Reply-To address.
 *
 * If RESEND_API_KEY is unset the service throws EMAIL_NOT_CONFIGURED, matching
 * how apiKeyAuth fails fast on missing config — callers surface a clear 500
 * rather than silently pretending to send.
 *
 * Non-production convenience: when NODE_ENV !== "production" and no API key is
 * set, emails are logged to the console instead of sent, so local dev and the
 * verification flow work without procuring a key. Production always requires
 * real config.
 */

import { AppError, ErrorCodes } from "../errors";
import { isProduction } from "../middleware/requireProduction";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function getFrom(): string {
  // A sensible default keeps dev working; production must set a verified sender.
  return process.env.EMAIL_FROM || "Monocle <onboarding@resend.dev>";
}

/**
 * Send an email. Throws AppError(EMAIL_NOT_CONFIGURED | EMAIL_SEND_FAILED) on
 * failure. In non-production without an API key, logs and resolves.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (!isProduction()) {
      console.log(
        `\n[emailService] RESEND_API_KEY not set — dev fallback, not sending.\n` +
          `  To:      ${input.to}\n` +
          `  Subject: ${input.subject}\n` +
          `  Text:\n${input.text}\n`
      );
      return;
    }
    throw new AppError(ErrorCodes.EMAIL_NOT_CONFIGURED, { provider: "resend" });
  }

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: getFrom(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
      }),
    });
  } catch (err: any) {
    throw new AppError(ErrorCodes.EMAIL_SEND_FAILED, {
      provider: "resend",
      reason: err?.message ?? String(err),
    });
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore body read errors */
    }
    throw new AppError(ErrorCodes.EMAIL_SEND_FAILED, {
      provider: "resend",
      status: res.status,
      // Truncate provider error bodies so we don't leak or bloat responses.
      detail: detail.slice(0, 300),
    });
  }
}

/**
 * Send the 6-digit email verification code. Kept as its own function so the
 * template lives next to the delivery logic.
 */
export async function sendVerificationEmail(to: string, code: string, ttlMinutes: number): Promise<void> {
  const subject = "Verify your Monocle email";
  const text =
    `Your Monocle verification code is: ${code}\n\n` +
    `Enter this code to verify your email. It expires in ${ttlMinutes} minutes.\n\n` +
    `If you didn't request this, you can ignore this email.`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#18181b">
    <h1 style="font-size:20px;margin:0 0 8px">Verify your email</h1>
    <p style="color:#52525b;font-size:14px;margin:0 0 24px">
      Enter this code in Monocle to verify your email address.
    </p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f4f4f5;border-radius:12px;padding:16px;text-align:center;color:#09090b">
      ${code}
    </div>
    <p style="color:#a1a1aa;font-size:12px;margin:24px 0 0">
      This code expires in ${ttlMinutes} minutes. If you didn't request it, you can safely ignore this email.
    </p>
  </div>`;

  await sendEmail({ to, subject, html, text });
}

/** Basic RFC-ish email format check. Deliberately permissive but bounded. */
export function isValidEmail(email: unknown): email is string {
  if (typeof email !== "string") return false;
  if (email.length > 254) return false;
  // one @, non-empty local part, a dotted domain
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Normalize an email for storage/lookup (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
