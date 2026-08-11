import { useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Link from "next/link";
import {
  register as apiRegister,
  login as apiLogin,
  sendVerificationCode,
  verifyEmail,
  AuthError,
  AuthUser,
} from "../lib/auth-api";
import { RevealedKey } from "../components/ApiKeyPanel";

type EmailMode = "login" | "register";
/**
 * `apikey` is gone: developers no longer paste a key to sign in. A key is minted
 * for them when they verify their email and shown once on the `key` step below.
 */
type Step = "credentials" | "verify" | "key";

export default function Login() {
  const router = useRouter();

  // ---- email/password + verification state ----
  const [mode, setMode] = useState<EmailMode>("login");
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The freshly minted key, held only in component state for the single render
  // that shows it. Never persisted — it is unrecoverable once dismissed, which is
  // exactly what the copy on screen tells the user.
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  const goToApp = () => router.push("/economy");

  function afterAuth(user: AuthUser, sent?: boolean) {
    if (user.emailVerified) {
      goToApp();
      return;
    }
    setStep("verify");
    if (sent === false) {
      setNotice("Account ready, but we couldn't send the email. Tap Resend to try again.");
      return;
    }
    if (sent === true) {
      setNotice(`We sent a 6-digit code to ${user.email}. Enter it below to verify.`);
      return;
    }
    setNotice(`Account ready. Tap Resend to get a fresh 6-digit code at ${user.email ?? "your email"}.`);
  }

  async function handleCredentials() {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        const { user, verificationEmailSent } = await apiRegister(email.trim(), password);
        afterAuth(user, verificationEmailSent);
      } else {
        const { user, verificationEmailSent } = await apiLogin(email.trim(), password);
        afterAuth(user, verificationEmailSent);
      }
    } catch (err) {
      setError(humanize(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setError(null);
    setNotice(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const { user, apiKey } = await verifyEmail(code);
      if (!user.emailVerified) return;

      // First verification mints the developer's key and returns it here, once.
      // Anything else (a returning user re-verifying) gets null and goes straight
      // through — there is no key to show, and none can be recovered.
      if (apiKey) {
        setIssuedKey(apiKey);
        setStep("key");
        setNotice(null);
        return;
      }
      goToApp();
    } catch (err) {
      setError(humanize(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { email: to, sent } = await sendVerificationCode();
      setNotice(
        sent
          ? `New code sent to ${to}.`
          : "We created a fresh code, but couldn't deliver the email. Check the mail provider and try again."
      );
    } catch (err) {
      setError(humanize(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Head>
      <title>Sign In | Monocle</title>
      <meta name="description" content="Sign in to Monocle to manage your autonomous AI agents." />
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center px-4">
      <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl p-10 max-w-[420px] w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-1">Monocle</h1>
          <p className="text-zinc-500 text-sm">Agent Economy Control Panel</p>
        </div>

        {step === "credentials" && (
          <div>
            <div className="flex gap-4 mb-5 text-sm">
              <ModeLink active={mode === "login"} onClick={() => setMode("login")}>
                Sign in
              </ModeLink>
              <ModeLink active={mode === "register"} onClick={() => setMode("register")}>
                Create account
              </ModeLink>
            </div>

            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              onEnter={handleCredentials}
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
              onEnter={handleCredentials}
            />

            <PrimaryButton busy={busy} onClick={handleCredentials}>
              {mode === "register" ? "Create account" : "Sign in"}
            </PrimaryButton>

            <p className="text-zinc-600 text-xs mt-4 text-center">
              Email is used for account recovery and identity verification (KYC).
            </p>
          </div>
        )}

        {step === "verify" && (
          <div>
            <h2 className="text-white text-lg font-semibold mb-1">Verify your email</h2>
            <p className="text-zinc-500 text-sm mb-5">
              Required to settle payouts, withdraw, or register an agent.
            </p>

            <Field
              label="6-digit code"
              type="text"
              value={code}
              onChange={(v: string) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              onEnter={handleVerify}
            />

            <PrimaryButton busy={busy} onClick={handleVerify}>
              Verify email
            </PrimaryButton>

            <div className="flex justify-between mt-4 text-xs">
              <button onClick={handleResend} disabled={busy} className="text-zinc-400 hover:text-white">
                Resend code
              </button>
              <button
                onClick={() => {
                  setStep("credentials");
                  setCode("");
                  setError(null);
                  setNotice(null);
                }}
                className="text-zinc-500 hover:text-white"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {step === "key" && issuedKey && (
          <div>
            <h2 className="text-white text-lg font-semibold mb-1">Your API key</h2>
            <p className="text-zinc-500 text-sm mb-5">
              Email verified. Here is your key for calling Monocle from your own
              services.
            </p>
            <RevealedKey
              keyValue={issuedKey}
              onDone={() => {
                setIssuedKey(null);
                goToApp();
              }}
            />
          </div>
        )}

        {error && <p className="text-red-400 mt-4 text-sm text-center">{error}</p>}
        {notice && <p className="text-emerald-400 mt-4 text-sm text-center">{notice}</p>}

        <div className="mt-8 flex gap-4 justify-center border-t border-zinc-800/60 pt-6">
          <FooterLink href="/">Marketplace</FooterLink>
          <FooterLink href="/dashboard">Dashboard</FooterLink>
          <FooterLink href="/economy">Economy</FooterLink>
        </div>
      </div>
    </div>
    </>
  );
}

/** Map backend error codes to friendly copy. */
function humanize(err: unknown): string {
  if (err instanceof AuthError) {
    switch (err.code) {
      case "AUTH_INVALID_CREDENTIALS":
        return "Incorrect email or password.";
      case "AUTH_EMAIL_ALREADY_REGISTERED":
        return "An account with this email already exists. Try signing in.";
      case "AUTH_VERIFICATION_INVALID":
        return "That code is invalid or was already used. Try resending.";
      case "AUTH_VERIFICATION_EXPIRED":
        return "That code expired. Tap Resend for a new one.";
      case "EMAIL_NOT_CONFIGURED":
        return "Email delivery isn't set up on the server yet.";
      case "VALIDATION_INVALID_FORMAT":
        return "Please check your email and password.";
      default:
        return err.message || "Something went wrong.";
    }
  }
  return "Network error. Please try again.";
}

// ---- small presentational helpers ----

function ModeLink({ active, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`pb-1 border-b-2 transition-colors ${
        active ? "border-white text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, type, value, onChange, placeholder, onEnter }: any) {
  return (
    <div className="mb-4">
      <label className="block text-zinc-400 text-xs mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
      />
    </div>
  );
}

function PrimaryButton({ busy, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="w-full py-3 bg-white text-zinc-900 font-semibold rounded-xl hover:bg-zinc-200 transition-colors disabled:opacity-50"
    >
      {busy ? "..." : children}
    </button>
  );
}

function FooterLink({ href, children }: any) {
  return (
    <Link href={href} className="text-zinc-500 text-sm hover:text-white transition-colors">
      {children}
    </Link>
  );
}
