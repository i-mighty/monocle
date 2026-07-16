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

type Tab = "email" | "apikey";
type EmailMode = "login" | "register";
type Step = "credentials" | "verify";

export default function Login() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("email");

  // ---- email/password + verification state ----
  const [mode, setMode] = useState<EmailMode>("login");
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ---- api key state ----
  const [key, setKey] = useState("");
  const [savedKey, setSavedKey] = useState(false);

  const goToApp = () => router.push("/economy");

  function afterAuth(user: AuthUser, sent?: boolean) {
    if (user.emailVerified) {
      goToApp();
      return;
    }
    // Not verified yet — move to the code step.
    setStep("verify");
    setNotice(
      sent === false
        ? "Account ready, but we couldn't send the email. Tap Resend to try again."
        : `We sent a 6-digit code to ${user.email}. Enter it below to verify.`
    );
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
        const { user } = await apiLogin(email.trim(), password);
        afterAuth(user);
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
      const { user } = await verifyEmail(code);
      if (user.emailVerified) goToApp();
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
      const { email: to } = await sendVerificationCode();
      setNotice(`New code sent to ${to}.`);
    } catch (err) {
      setError(humanize(err));
    } finally {
      setBusy(false);
    }
  }

  function handleSaveKey() {
    if (key.trim()) {
      localStorage.setItem("apiKey", key.trim());
      setSavedKey(true);
      setTimeout(goToApp, 800);
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

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl mb-6">
          <TabButton active={tab === "email"} onClick={() => setTab("email")}>
            Email
          </TabButton>
          <TabButton active={tab === "apikey"} onClick={() => setTab("apikey")}>
            API Key
          </TabButton>
        </div>

        {tab === "email" && step === "credentials" && (
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

        {tab === "email" && step === "verify" && (
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

        {tab === "apikey" && (
          <div>
            <h2 className="text-white text-lg font-semibold mb-4">Enter API Key</h2>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your API key"
              onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            <p className="text-zinc-600 text-xs mt-2 mb-4">
              Programmatic key from the backend .env (for SDK / machine access).
            </p>
            <PrimaryButton busy={false} onClick={handleSaveKey}>
              Continue with API key
            </PrimaryButton>
            {savedKey && <p className="text-emerald-400 mt-4 text-sm text-center">Saved! Redirecting…</p>}
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

function TabButton({ active, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? "bg-white text-zinc-900" : "text-zinc-400 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

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
      {busy ? "…" : children}
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
