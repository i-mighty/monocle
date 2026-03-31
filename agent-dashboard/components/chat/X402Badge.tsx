"use client";

import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────
interface X402BadgeProps {
  txSignature?: string | null;
  amountUsdc?: number | null;
  agentName?: string;
  network?: "devnet" | "mainnet-beta";
  /** Poll this endpoint to get tx signature after message arrives */
  pollLogId?: string;
}

type TxStatus = "pending" | "confirmed" | "failed" | null;

// ─── Helpers ─────────────────────────────────────────────────
const EXPLORER = (sig: string, net: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=${net}`;

const short = (sig: string) =>
  `${sig.slice(0, 6)}...${sig.slice(-5)}`;

// ─── Main Component ───────────────────────────────────────────
export function X402Badge({
  txSignature,
  amountUsdc,
  agentName,
  network = "devnet",
  pollLogId,
}: X402BadgeProps) {
  const [sig, setSig] = useState<string | null>(txSignature ?? null);
  const [status, setStatus] = useState<TxStatus>(txSignature ? "confirmed" : null);
  const [amount, setAmount] = useState<number | null>(amountUsdc ?? null);
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  // Animate in after mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  // Update from props when they change (e.g. SSE delivers txSignature late)
  useEffect(() => {
    if (txSignature && txSignature !== sig) {
      setSig(txSignature);
      setStatus("confirmed");
    }
  }, [txSignature]);

  useEffect(() => {
    if (amountUsdc != null) setAmount(amountUsdc);
  }, [amountUsdc]);

  // Poll for tx signature if we have a logId but no sig yet
  useEffect(() => {
    if (sig || !pollLogId) return;
    setStatus("pending");

    let attempts = 0;
    const MAX = 20;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MAX) { clearInterval(interval); setStatus("failed"); return; }
      try {
        const base = process.env.NEXT_PUBLIC_MONOCLE_API_URL ?? "http://localhost:3001";
        const res = await fetch(`${base}/v1/x402-feed/tx/${pollLogId}`, {
          headers: { "x-api-key": process.env.NEXT_PUBLIC_MONOCLE_API_KEY ?? "" },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.txSignature) {
          setSig(data.txSignature);
          setAmount(data.amountUsdc ?? null);
          setStatus("confirmed");
          clearInterval(interval);
        }
      } catch { /* retry */ }
    }, 1500);

    return () => clearInterval(interval);
  }, [sig, pollLogId]);

  const handleCopy = () => {
    if (!sig) return;
    navigator.clipboard.writeText(sig);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // ─── Pending state ───────────────────────────────────────────
  if (status === "pending") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 11px",
          marginTop: "8px",
          background: "rgba(139,124,248,0.06)",
          border: "1px solid rgba(139,124,248,0.15)",
          borderRadius: "7px",
          fontSize: "11px",
          fontFamily: "'JetBrains Mono', monospace",
          color: "rgba(180,169,255,0.6)",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(4px)",
          transition: "opacity 0.2s ease, transform 0.2s ease",
        }}
      >
        <PendingDots />
        x402 payment settling on Solana...
      </div>
    );
  }

  // ─── Failed / no sig ─────────────────────────────────────────
  if (status === "failed" || (!sig && !pollLogId)) return null;

  // ─── Confirmed ───────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0",
        marginTop: "8px",
        marginBottom: "10px",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(4px)",
        transition: "opacity 0.25s ease, transform 0.25s ease",
      }}
    >
      {/* Main tx link */}
      <a
        href={sig ? EXPLORER(sig, network) : "#"}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "7px",
          padding: "5px 11px",
          background: "rgba(62,207,142,0.06)",
          border: "1px solid rgba(62,207,142,0.18)",
          borderRadius: "7px 0 0 7px",
          fontSize: "11px",
          fontFamily: "'JetBrains Mono', monospace",
          color: "rgba(62,207,142,0.85)",
          textDecoration: "none",
          transition: "background 0.15s",
          flex: 1,
          minWidth: 0,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(62,207,142,0.12)")}
        onMouseLeave={e => (e.currentTarget.style.background = "rgba(62,207,142,0.06)")}
      >
        {/* Pulse dot */}
        <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <span style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: "#3ecf8e", boxShadow: "0 0 6px rgba(62,207,142,0.6)",
            flexShrink: 0,
          }} />
        </span>

        {/* Label */}
        <span style={{ color: "rgba(62,207,142,0.5)", marginRight: "2px" }}>x402</span>
        <span style={{ color: "rgba(241,241,245,0.7)", marginRight: "4px" }}>·</span>

        {/* Amount if available */}
        {amount !== null && (
          <>
            <span style={{ color: "rgba(62,207,142,0.9)", fontWeight: 500 }}>
              ${amount.toFixed(4)} USDC
            </span>
            <span style={{ color: "rgba(241,241,245,0.3)", margin: "0 4px" }}>·</span>
          </>
        )}

        {/* Agent */}
        {agentName && (
          <>
            <span style={{ color: "rgba(180,169,255,0.7)" }}>{agentName}</span>
            <span style={{ color: "rgba(241,241,245,0.3)", margin: "0 4px" }}>·</span>
          </>
        )}

        {/* Tx hash */}
        <span style={{ color: "rgba(62,207,142,0.6)" }}>
          {sig ? short(sig) : "pending"}
        </span>

        {/* Arrow */}
        <span style={{
          marginLeft: "auto",
          paddingLeft: "8px",
          color: "rgba(62,207,142,0.4)",
          fontSize: "10px",
        }}>↗</span>
      </a>

      {/* Copy button */}
      <button
        onClick={handleCopy}
        title="Copy tx signature"
        style={{
          padding: "5px 9px",
          background: copied ? "rgba(62,207,142,0.15)" : "rgba(62,207,142,0.04)",
          border: "1px solid rgba(62,207,142,0.18)",
          borderLeft: "none",
          borderRadius: "0 7px 7px 0",
          color: copied ? "rgba(62,207,142,0.9)" : "rgba(62,207,142,0.4)",
          cursor: "pointer",
          fontSize: "10px",
          fontFamily: "'JetBrains Mono', monospace",
          transition: "all 0.15s",
          flexShrink: 0,
          lineHeight: 1,
        }}
        onMouseEnter={e => !copied && (e.currentTarget.style.background = "rgba(62,207,142,0.1)")}
        onMouseLeave={e => !copied && (e.currentTarget.style.background = "rgba(62,207,142,0.04)")}
      >
        {copied ? "✓" : "⎘"}
      </button>
    </div>
  );
}

// ─── Pending animation ────────────────────────────────────────
function PendingDots() {
  return (
    <span style={{ display: "flex", gap: "3px", alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: "4px", height: "4px", borderRadius: "50%",
            background: "rgba(139,124,248,0.6)",
            animation: `x402-blink 1.2s infinite ${i * 0.15}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes x402-blink {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.7); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </span>
  );
}
