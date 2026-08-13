import { useEffect, useState } from "react";
import { getMyAgents, setPayoutWallet, sendPayoutWalletCode, ApiError } from "../lib/api";

/**
 * Where this agent gets paid.
 *
 * Settlements land here and x402 callers transfer to it directly, so whoever
 * controls this address collects the agent's income. Shown only to the owner —
 * decided by asking which agents are mine rather than by anything in the URL, so
 * sending someone your agent's page does not offer them the control. The server
 * enforces ownership regardless; hiding it is courtesy.
 *
 * Setting a first wallet is one step. Changing an existing one asks for an
 * emailed code, because that redirects money already flowing.
 */
type Stage = "idle" | "editing" | "confirm" | "code";

export default function PayoutWalletPanel({
  agentId,
  currentWallet,
  onSaved,
}: {
  agentId: string;
  currentWallet: string | null;
  onSaved?: (wallet: string) => void;
}) {
  const [isOwner, setIsOwner] = useState(false);
  const [checking, setChecking] = useState(true);
  const [wallet, setWallet] = useState<string | null>(currentWallet);
  const [stage, setStage] = useState<Stage>("idle");
  const [input, setInput] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { agents } = await getMyAgents();
        setIsOwner(agents.some((a) => a.agentId === agentId));
      } catch {
        setIsOwner(false);
      } finally {
        setChecking(false);
      }
    })();
  }, [agentId]);

  useEffect(() => setWallet(currentWallet), [currentWallet]);

  if (checking || !isOwner) return null;

  /** Same shape check the server applies, so the error arrives without a round trip. */
  const looksLikeSolanaAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

  async function save(withCode?: string) {
    const next = input.trim();
    if (!looksLikeSolanaAddress(next)) {
      setError(
        "That doesn't look like a Solana wallet address. It should be 32–44 base58 characters, with no 0, O, I or l."
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await setPayoutWallet(agentId, next, withCode);
      setWallet(res.publicKey);
      setStage("idle");
      setInput("");
      setCode("");
      // A change is emailed to the owner as a security notice. If that send
      // failed, say so — otherwise an owner assumes they'd have been told, and a
      // change they didn't make passes unnoticed.
      const base = res.previousWallet
        ? "Payout wallet changed. Anything already earned settles to the new address."
        : "Payout wallet set. This agent can now be paid.";
      setNotice(
        res.ownerNotified === false
          ? `${base} We couldn't email the confirmation — the change is recorded either way.`
          : base
      );
      onSaved?.(res.publicKey);
    } catch (err) {
      // The server answers "step-up required" when a wallet already exists, which
      // is a route into the confirm flow rather than an error to show raw.
      if (err instanceof ApiError && String(err.message).includes("requires confirmation")) {
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
      const { sent, email } = await sendPayoutWalletCode(agentId);
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

  const truncate = (s: string) => (s.length > 18 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);

  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-6">
      <h2 className="text-sm font-semibold text-white mb-1">Payout wallet</h2>
      <p className="text-zinc-500 text-sm mb-5">
        Where this agent is paid. Callers transfer here directly, so it must be a
        wallet you control.
      </p>

      {stage === "idle" && (
        <div>
          {wallet ? (
            <>
              <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1.5">Current</div>
              <code
                title={wallet}
                className="block px-3 py-2.5 bg-zinc-950 border border-zinc-800/60 rounded-lg text-zinc-300 text-xs font-mono break-all select-all mb-4"
              >
                {wallet}
              </code>
              <button
                onClick={() => {
                  setInput("");
                  setNotice(null);
                  setStage("editing");
                }}
                className="w-full py-2.5 bg-zinc-800 text-white rounded-lg text-sm font-semibold hover:bg-zinc-700 transition-colors"
              >
                Change payout wallet
              </button>
            </>
          ) : (
            <>
              <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg p-4 mb-4">
                <p className="text-amber-200 text-sm font-medium mb-1">This agent has no payout wallet.</p>
                <p className="text-amber-200/70 text-sm">
                  It cannot be paid and will not be quoted until you set one.
                </p>
              </div>
              <button
                onClick={() => {
                  setNotice(null);
                  setStage("editing");
                }}
                className="w-full py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors"
              >
                Set payout wallet
              </button>
            </>
          )}
        </div>
      )}

      {stage === "editing" && (
        <div>
          <label className="block text-zinc-400 text-xs mb-2">Solana wallet address</label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="Base58 address, e.g. 7xKX…gAsU"
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-xs font-mono mb-3 focus:outline-none focus:border-zinc-600"
          />
          {wallet && (
            <p className="text-zinc-600 text-xs mb-3">
              Replaces {truncate(wallet)}. You&apos;ll be asked to confirm by email.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => save()}
              disabled={busy || !input.trim()}
              className="flex-1 py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {busy ? "Saving..." : wallet ? "Continue" : "Set wallet"}
            </button>
            <button onClick={() => setStage("idle")} disabled={busy} className="px-4 py-2.5 text-zinc-400 hover:text-white text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === "confirm" && (
        <div>
          <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg p-4 mb-4">
            <p className="text-amber-200 text-sm font-medium mb-1">Confirm where this agent is paid.</p>
            <p className="text-amber-200/70 text-sm">
              Future payments — and anything already earned but not yet settled — go to{" "}
              <span className="font-mono">{truncate(input.trim())}</span> instead of{" "}
              <span className="font-mono">{wallet ? truncate(wallet) : "—"}</span>.
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
            <button onClick={() => setStage("editing")} disabled={busy} className="px-4 py-2.5 text-zinc-400 hover:text-white text-sm">
              Back
            </button>
          </div>
        </div>
      )}

      {stage === "code" && (
        <div>
          <label className="block text-zinc-400 text-xs mb-2">6-digit code</label>
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && /^\d{6}$/.test(code) && save(code)}
            placeholder="123456"
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm tracking-widest mb-3 focus:outline-none focus:border-zinc-600"
          />
          <div className="flex gap-2">
            <button
              onClick={() => save(code)}
              disabled={busy || !/^\d{6}$/.test(code)}
              className="flex-1 py-2.5 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {busy ? "Changing..." : "Change payout wallet"}
            </button>
            <button onClick={() => setStage("idle")} disabled={busy} className="px-4 py-2.5 text-zinc-400 hover:text-white text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-red-400 mt-4 text-sm">{error}</p>}
      {notice && <p className="text-emerald-400 mt-4 text-sm">{notice}</p>}
    </section>
  );
}

function humanize(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "AUTH_INSUFFICIENT_PERMISSIONS":
        return "You can only change the payout wallet of an agent you own.";
      case "AUTH_EMAIL_NOT_VERIFIED":
        return "Verify your email before changing where this agent is paid.";
      case "AUTH_VERIFICATION_INVALID":
        return "That code is invalid or was already used. Send a new one.";
      case "AUTH_VERIFICATION_EXPIRED":
        return "That code expired. Send a new one.";
      case "VALIDATION_INVALID_FORMAT":
        return err.message || "That wallet address can't be used.";
      case "RATE_LIMIT_EXCEEDED":
        return err.message || "Too many requests. Wait a moment.";
      default:
        return err.message || "Something went wrong.";
    }
  }
  return "Network error. Please try again.";
}
