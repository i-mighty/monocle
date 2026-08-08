/**
 * Transactional email delivery. Supports two providers, chosen by config:
 *
 *   SMTP (e.g. Brevo, Mailgun, SES) — set when SMTP_HOST is present:
 *     SMTP_HOST   e.g. smtp-relay.brevo.com
 *     SMTP_PORT   e.g. 587 (STARTTLS) or 465 (implicit TLS)
 *     SMTP_USER   SMTP login
 *     SMTP_PASS   SMTP password/key
 *   Resend REST API — used when SMTP is not set but RESEND_API_KEY is:
 *     RESEND_API_KEY
 *   Shared:
 *     EMAIL_FROM      sender, e.g. "Monocle <noreply@yourdomain.com>" (must be a
 *                     validated sender for the provider)
 *     EMAIL_REPLY_TO  optional Reply-To
 *
 * SMTP is preferred because a provider like Brevo can deliver to any recipient,
 * whereas Resend on the shared onboarding domain only reaches the account owner.
 *
 * If neither provider is configured: in non-production the email is logged to the
 * console (so local dev works without a provider); in production it throws
 * EMAIL_NOT_CONFIGURED so a missing config surfaces as a clear error rather than
 * silently dropping mail.
 */

import nodemailer, { Transporter } from "nodemailer";
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
  // A sensible default keeps dev working; production must set a validated sender.
  return process.env.EMAIL_FROM || "Monocle <onboarding@resend.dev>";
}

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

// One reused transporter (connection pooling) rather than one per email.
let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 uses STARTTLS
    requireTLS: port !== 465,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

function describeSmtpError(err: any): { reason: string; hint?: string } {
  const reason = err?.response || err?.message || String(err);
  const hint = typeof reason === "string" && reason.includes("Unauthorized IP address")
    ? "Brevo blocked this server IP. Add the backend host IP to Brevo Authorized IPs before retrying."
    : undefined;
  return { reason, hint };
}

async function sendViaSmtp(input: SendEmailInput): Promise<void> {
  try {
    await getTransporter().sendMail({
      from: getFrom(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(process.env.EMAIL_REPLY_TO ? { replyTo: process.env.EMAIL_REPLY_TO } : {}),
    });
  } catch (err: any) {
    const { reason, hint } = describeSmtpError(err);
    throw new AppError(ErrorCodes.EMAIL_SEND_FAILED, {
      provider: "smtp",
      host: process.env.SMTP_HOST,
      reason,
      ...(hint ? { hint } : {}),
    });
  }
}

async function sendViaResend(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY!;
  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
    throw new AppError(ErrorCodes.EMAIL_SEND_FAILED, { provider: "resend", reason: err?.message ?? String(err) });
  }
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { /* ignore body read errors */ }
    throw new AppError(ErrorCodes.EMAIL_SEND_FAILED, {
      provider: "resend",
      status: res.status,
      detail: detail.slice(0, 300),
    });
  }
}

/**
 * Send an email via the configured provider. Throws
 * AppError(EMAIL_NOT_CONFIGURED | EMAIL_SEND_FAILED) on failure. In non-production
 * with no provider configured, logs and resolves.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (smtpConfigured()) return sendViaSmtp(input);
  if (process.env.RESEND_API_KEY) return sendViaResend(input);

  if (!isProduction()) {
    console.log(
      `\n[emailService] no email provider configured — dev fallback, not sending.\n` +
        `  To:      ${input.to}\n` +
        `  Subject: ${input.subject}\n` +
        `  Text:\n${input.text}\n`
    );
    return;
  }
  throw new AppError(ErrorCodes.EMAIL_NOT_CONFIGURED, { provider: "none" });
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
