import Head from "next/head";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import ApiKeyPanel from "../components/ApiKeyPanel";
import MyAgentsPanel from "../components/MyAgentsPanel";
import { getMe, logout, sendVerificationCode, AuthUser } from "../lib/auth-api";

/**
 * Account page: who you are signed in as, your API key, and the way out.
 *
 * The API key panel lives here rather than on the economy page. A credential
 * belongs with the account it authenticates, not beside agent controls — and the
 * economy page only hosted it because that page used to be where you pasted a key
 * in.
 *
 * Read-only for now. Nothing here can be edited because no endpoint exists to
 * edit it: `display_name` is in the schema and comes back from /v1/auth/me, but
 * the backend has no route that writes it. Showing an input that silently does
 * nothing would be worse than showing none.
 */
type Tab = "account" | "agents";

export default function Profile() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("account");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setUser(await getMe());
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
      // Full reload rather than a client-side push: the session cookie is
      // HttpOnly and cleared server-side, so every cached page and any state
      // holding account data has to go with it.
      window.location.href = "/";
    } catch {
      setError("Couldn't sign out. Try again.");
      setSigningOut(false);
    }
  }

  async function handleResendVerification() {
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const { sent, email } = await sendVerificationCode();
      setNotice(
        sent
          ? `Verification code sent to ${email}. Enter it on the sign-in screen.`
          : "We created a code but couldn't send the email. Try again shortly."
      );
    } catch (err: any) {
      setError(err?.message || "Couldn't send a verification code.");
    } finally {
      setResending(false);
    }
  }

  if (loading) {
    return (
      <Layout title="Profile">
        <p className="text-zinc-500 text-sm">Loading...</p>
      </Layout>
    );
  }

  // Middleware normally prevents this, but a session can expire between the page
  // being served and this request, so the page has to cope with it too.
  if (!user) {
    return (
      <Layout title="Profile">
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 max-w-xl">
          <p className="text-zinc-400 text-sm mb-4">Your session has ended.</p>
          <button
            onClick={() => router.push("/login?next=%2Fprofile")}
            className="px-4 py-2 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors"
          >
            Sign in
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <>
      <Head>
        <title>Profile | Monocle</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Layout title="Profile">
        <div className="flex gap-2 mb-6 border-b border-zinc-800/60 max-w-xl">
          {([
            { id: "account", label: "Account" },
            { id: "agents", label: "My agents" },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm transition-colors -mb-px border-b-2 ${
                tab === t.id
                  ? "border-white text-white font-medium"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "agents" && (
          <div className="max-w-3xl">
            <MyAgentsPanel />
          </div>
        )}

        <div className={`max-w-xl space-y-6 ${tab === "account" ? "" : "hidden"}`}>
          {/* Account */}
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
            <h2 className="text-white text-base font-semibold mb-5">Account</h2>

            <dl className="space-y-3 text-sm">
              <Row label="Email" value={user.email ?? "Not set"} />
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Email status</dt>
                <dd>
                  {user.emailVerified ? (
                    <span className="text-emerald-400">Verified</span>
                  ) : (
                    <span className="text-amber-400">Unverified</span>
                  )}
                </dd>
              </div>
              {user.displayName && <Row label="Display name" value={user.displayName} />}
              {user.solName && <Row label="SOL name" value={user.solName} />}
              {user.wallet && <Row label="Wallet" value={truncateMiddle(user.wallet)} />}
              {user.createdAt && (
                <Row label="Member since" value={new Date(user.createdAt).toLocaleDateString()} />
              )}
              {user.lastSeenAt && (
                <Row label="Last seen" value={new Date(user.lastSeenAt).toLocaleString()} />
              )}
            </dl>

            {!user.emailVerified && (
              <div className="mt-5 bg-amber-950/40 border border-amber-900/50 rounded-lg p-4">
                <p className="text-amber-200 text-sm mb-1 font-medium">Your email isn&apos;t verified.</p>
                <p className="text-amber-200/70 text-sm mb-3">
                  Settling payouts, withdrawing, and registering an agent stay locked until it is.
                </p>
                <button
                  onClick={handleResendVerification}
                  disabled={resending}
                  className="px-3 py-1.5 bg-amber-200/10 text-amber-100 rounded-lg text-sm font-medium hover:bg-amber-200/20 disabled:opacity-50 transition-colors"
                >
                  {resending ? "Sending..." : "Send verification code"}
                </button>
              </div>
            )}

            {notice && <p className="text-emerald-400 mt-4 text-sm">{notice}</p>}
            {error && <p className="text-red-400 mt-4 text-sm">{error}</p>}
          </div>

          {/* API key */}
          <ApiKeyPanel />

          {/* Sign out */}
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
            <h2 className="text-white text-base font-semibold mb-1">Sign out</h2>
            <p className="text-zinc-500 text-sm mb-4">
              Ends this session on this device. Your API key keeps working — it is
              independent of the browser session.
            </p>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-semibold hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </Layout>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-300 text-right break-all">{value}</dd>
    </div>
  );
}

/** Wallet addresses are too long to show whole and too important to truncate at one end. */
function truncateMiddle(s: string, head = 6, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}...${s.slice(-tail)}`;
}
