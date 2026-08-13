import { useEffect, useState } from "react";
import {
  getApiKeyMetadata,
  sendRegenerateCode,
  regenerateApiKey,
  ApiKeyMetadata,
  AuthError,
} from "../lib/auth-api";
import { API_BASE_URL } from "../lib/api";

/**
 * The developer's API key, shown once and regenerated thereafter.
 *
 * There is no "Reveal" here and there cannot be: the key is stored as a one-way
 * digest, so after the single moment it is displayed the server genuinely cannot
 * produce it again. Regenerating is the only way to get a working key back, and
 * it invalidates the previous one — hence the confirmation step, which exists to
 * make sure nobody clicks it expecting to simply look at what they already have.
 */

type Stage = "idle" | "confirm" | "code" | "revealed";

export default function ApiKeyPanel() {
  const [meta, setMeta] = useState<ApiKeyMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>("idle");
  const [code, setCode] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const { key } = await getApiKeyMetadata();
      setMeta(key);
    } catch {
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendCode() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { sent, email } = await sendRegenerateCode();
      setStage("code");
      setNotice(
        sent
          ? `We sent a 6-digit code to ${email}. Enter it to confirm.`
          : "We created a code but couldn't send the email. Try again shortly."
      );
    } catch (err) {
      setError(humanize(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const { apiKey } = await regenerateApiKey(code);
      setNewKey(apiKey);
      setStage("revealed");
      setCode("");
      setNotice(null);
      void refresh();
    } catch (err) {
      setError(humanize(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage("idle");
    setCode("");
    setNewKey(null);
    setError(null);
    setNotice(null);
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-white text-base font-semibold">API Key</h2>
        {meta && stage === "idle" && (
          <span className="text-zinc-600 text-xs">{meta.name}</span>
        )}
      </div>
      <p className="text-zinc-500 text-sm mb-5">
        Use this key to call Monocle from your own services. It is shown once when
        created and stored only as a hash, so it cannot be displayed again.
      </p>

      {loading ? (
        <p className="text-zinc-600 text-sm">Loading...</p>
      ) : stage === "revealed" && newKey ? (
        <RevealedKey
          keyValue={newKey}
          onDone={() => {
            reset();
            void refresh();
          }}
        />
      ) : stage === "confirm" ? (
        <div>
          <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg p-4 mb-4">
            <p className="text-amber-200 text-sm font-medium mb-1">
              This will invalidate your current key.
            </p>
            <p className="text-amber-200/70 text-sm">
              Any service using it will stop working until updated.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSendCode}
              disabled={busy}
              className="flex-1 py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {busy ? "Sending..." : "Send confirmation code"}
            </button>
            <button
              onClick={reset}
              disabled={busy}
              className="px-4 py-2.5 text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : stage === "code" ? (
        <div>
          <label className="block text-zinc-400 text-xs mb-2">6-digit code</label>
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && handleRegenerate()}
            placeholder="123456"
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm tracking-widest mb-3 focus:outline-none focus:border-zinc-600 transition-colors"
          />
          <div className="flex gap-2">
            <button
              onClick={handleRegenerate}
              disabled={busy}
              className="flex-1 py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {busy ? "Regenerating..." : "Regenerate API Key"}
            </button>
            <button
              onClick={reset}
              disabled={busy}
              className="px-4 py-2.5 text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          {meta ? (
            <dl className="text-sm mb-5 space-y-1.5">
              <Row label="Created" value={new Date(meta.createdAt).toLocaleDateString()} />
              <Row
                label="Last used"
                value={meta.lastUsedAt ? new Date(meta.lastUsedAt).toLocaleString() : "Never"}
              />
              <Row label="Scopes" value={meta.scopes.length ? meta.scopes.join(", ") : "Default"} />
              {/* Visible without regenerating: the key cannot be shown again,
                  but where to send it is not a secret. */}
              <Row label="Base URL" value={API_BASE_URL} />
            </dl>
          ) : (
            <p className="text-zinc-500 text-sm mb-5">
              You don&apos;t have an active key. Generate one to start calling the API.
            </p>
          )}
          <button
            onClick={() => setStage("confirm")}
            className="w-full py-2.5 bg-zinc-800 text-white rounded-lg text-sm font-semibold hover:bg-zinc-700 transition-colors"
          >
            {meta ? "Regenerate API Key" : "Generate API Key"}
          </button>
        </div>
      )}

      {error && <p className="text-red-400 mt-4 text-sm">{error}</p>}
      {notice && stage !== "revealed" && <p className="text-emerald-400 mt-4 text-sm">{notice}</p>}
    </div>
  );
}

/**
 * The one and only moment the key is visible. Deliberately requires an explicit
 * dismissal rather than fading away, because once this is gone the value is
 * unrecoverable and the user's only option is to regenerate again.
 */
export function RevealedKey({ keyValue, onDone }: { keyValue: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(keyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the value is selectable on screen regardless */
    }
  }

  /**
   * A runnable first call, key and URL already filled in. This is the one moment
   * the plaintext exists, so it is the only moment such a snippet can be built.
   */
  async function copyCurl() {
    const snippet = `curl ${API_BASE_URL}/agents \\\n  -H "x-api-key: ${keyValue}"`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div>
      <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-lg p-4 mb-3">
        <p className="text-emerald-200 text-sm font-medium mb-1">
          Copy this key now — it won&apos;t be shown again.
        </p>
        <p className="text-emerald-200/70 text-sm">
          It&apos;s stored as a hash, so we can&apos;t recover it for you. If you lose it,
          you&apos;ll need to regenerate.
        </p>
      </div>
      <div className="flex gap-2 mb-4">
        <code className="flex-1 px-3 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-emerald-300 text-xs font-mono break-all select-all">
          {keyValue}
        </code>
        <button
          onClick={copy}
          className="px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors shrink-0"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* A key on its own is not enough to make a call, and nothing else in the
          product says where to send it. */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-widest text-zinc-600">Base URL</span>
          <button onClick={copyCurl} className="text-xs text-zinc-500 hover:text-white transition-colors">
            {copiedCurl ? "Copied" : "Copy curl example"}
          </button>
        </div>
        <code className="block px-3 py-2 bg-zinc-950 border border-zinc-800/60 rounded-lg text-zinc-300 text-xs font-mono break-all select-all">
          {API_BASE_URL}
        </code>
        <p className="text-zinc-600 text-xs mt-2">
          Send it as the <code className="text-zinc-500">x-api-key</code> header. The SDK uses this
          URL by default.
        </p>
      </div>

      <button
        onClick={onDone}
        className="w-full py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors"
      >
        I&apos;ve saved it
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-300 text-right truncate">{value}</dd>
    </div>
  );
}

function humanize(err: unknown): string {
  if (err instanceof AuthError) {
    switch (err.code) {
      case "AUTH_VERIFICATION_INVALID":
        return "That code is invalid or was already used. Send a new one.";
      case "AUTH_VERIFICATION_EXPIRED":
        return "That code expired. Send a new one.";
      case "RATE_LIMIT_EXCEEDED":
        return err.message || "Too many requests. Wait a moment and try again.";
      case "AUTH_EMAIL_NOT_VERIFIED":
        return "Verify your email before managing API keys.";
      case "EMAIL_NOT_CONFIGURED":
        return "Email delivery isn't set up on the server yet.";
      default:
        return err.message || "Something went wrong.";
    }
  }
  return "Network error. Please try again.";
}
