import { useEffect, useState } from "react";
import { getMyAgents, issueAgentKey, sendAgentKeyCode, ApiError } from "../lib/api";

/**
 * Issue or rotate this agent's `mk_` key.
 *
 * This is the credential every money route requires — meter/execute, settle,
 * withdraw all demand a key that names the calling agent, and the same-origin
 * proxy deliberately withholds the platform key from those paths. Without a key
 * of its own an agent can be registered and then do nothing.
 *
 * Shown only to the owner. Ownership is decided by asking which agents are mine
 * rather than by anything in the page URL, so linking someone your agent's page
 * does not offer them a key. The server enforces this regardless; hiding the
 * panel is courtesy, not the control.
 */
type Stage = "idle" | "confirm" | "code" | "revealed";

export default function AgentKeyPanel({ agentId }: { agentId: string }) {
  const [isOwner, setIsOwner] = useState(false);
  const [checking, setChecking] = useState(true);
  const [stage, setStage] = useState<Stage>("idle");
  const [code, setCode] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { agents } = await getMyAgents();
        setIsOwner(agents.some((a) => a.agentId === agentId));
      } catch {
        // Signed out, or the lookup failed — either way, offer nothing.
        setIsOwner(false);
      } finally {
        setChecking(false);
      }
    })();
  }, [agentId]);

  if (checking || !isOwner) return null;

  async function issue(withCode?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await issueAgentKey(agentId, withCode ? { rotate: true, code: withCode } : {});
      setIssued(res.apiKey);
      setStage("revealed");
      setCode("");
      setNotice(null);
    } catch (err) {
      // A first issuance that comes back demanding a step-up means a key already
      // exists, so this is really a rotation — send the user down that path
      // rather than showing them a raw verification error.
      if (err instanceof ApiError && String(err.message).includes("invalidates the current one")) {
        setStage("confirm");
        setError(null);
      } else {
        setError(humanize(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const { sent, email } = await sendAgentKeyCode(agentId);
      setStage("code");
      setNotice(
        sent ? `Code sent to ${email}. Enter it to confirm.` : "We made a code but couldn't email it. Try again shortly."
      );
    } catch (err) {
      setError(humanize(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; the value is selectable on screen */
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-6">
      <h2 className="text-sm font-semibold text-white mb-1">Agent API key</h2>
      <p className="text-zinc-500 text-sm mb-5">
        Required for this agent to bill, settle or withdraw. Shown once and stored
        as a hash, so it can be replaced but never re-read.
      </p>

      {stage === "revealed" && issued ? (
        <div>
          <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-lg p-4 mb-3">
            <p className="text-emerald-200 text-sm font-medium mb-1">Copy this key now — it won&apos;t be shown again.</p>
            <p className="text-emerald-200/70 text-sm">Give it to the service that runs this agent.</p>
          </div>
          <div className="flex gap-2 mb-4">
            <code className="flex-1 px-3 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-emerald-300 text-xs font-mono break-all select-all">
              {issued}
            </code>
            <button
              onClick={copy}
              className="px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors shrink-0"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => {
              setIssued(null);
              setStage("idle");
            }}
            className="w-full py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors"
          >
            I&apos;ve saved it
          </button>
        </div>
      ) : stage === "confirm" ? (
        <div>
          <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg p-4 mb-4">
            <p className="text-amber-200 text-sm font-medium mb-1">This agent already has a key.</p>
            <p className="text-amber-200/70 text-sm">
              Issuing a new one invalidates it. Anything calling Monocle as this agent stops working
              until updated.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={requestCode}
              disabled={busy}
              className="flex-1 py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {busy ? "Sending..." : "Send confirmation code"}
            </button>
            <button onClick={() => setStage("idle")} disabled={busy} className="px-4 py-2.5 text-zinc-400 hover:text-white text-sm">
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
            onKeyDown={(e) => e.key === "Enter" && /^\d{6}$/.test(code) && issue(code)}
            placeholder="123456"
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm tracking-widest mb-3 focus:outline-none focus:border-zinc-600"
          />
          <div className="flex gap-2">
            <button
              onClick={() => issue(code)}
              disabled={busy || !/^\d{6}$/.test(code)}
              className="flex-1 py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {busy ? "Rotating..." : "Rotate key"}
            </button>
            <button onClick={() => setStage("idle")} disabled={busy} className="px-4 py-2.5 text-zinc-400 hover:text-white text-sm">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => issue()}
          disabled={busy}
          className="w-full py-2.5 bg-zinc-800 text-white rounded-lg text-sm font-semibold hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {busy ? "Working..." : "Issue API key"}
        </button>
      )}

      {error && <p className="text-red-400 mt-4 text-sm">{error}</p>}
      {notice && stage !== "revealed" && <p className="text-emerald-400 mt-4 text-sm">{notice}</p>}
    </section>
  );
}

function humanize(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "AUTH_INSUFFICIENT_PERMISSIONS":
        return "You can only issue keys for agents you own.";
      case "AUTH_EMAIL_NOT_VERIFIED":
        return "Verify your email before issuing an agent key.";
      case "AUTH_VERIFICATION_INVALID":
        return "That code is invalid or was already used. Send a new one.";
      case "AUTH_VERIFICATION_EXPIRED":
        return "That code expired. Send a new one.";
      case "RATE_LIMIT_EXCEEDED":
        return err.message || "Too many requests. Wait a moment.";
      default:
        return err.message || "Something went wrong.";
    }
  }
  return "Network error. Please try again.";
}
