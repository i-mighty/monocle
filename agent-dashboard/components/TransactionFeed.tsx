/**
 * TransactionFeed — Real-time x402 payment event panel
 *
 * Shows a live feed of x402 Solana USDC payments flowing through Monocle.
 * Connects to the SSE endpoint at /v1/x402-feed/stream.
 */

import { useEffect, useRef, useState } from "react";

interface TxEvent {
  type: string;
  timestamp: string;
  path?: string;
  method?: string;
  network?: string;
  payer?: string;
  amount?: string;
  txSignature?: string;
  error?: string;
  agentId?: string;
  agentName?: string;
  x402Enabled?: boolean;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

function shortenAddr(addr?: string): string {
  if (!addr) return "—";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function typeLabel(type: string): { text: string; color: string } {
  switch (type) {
    case "payment_settled":
      return { text: "SETTLED", color: "text-green-400" };
    case "payment_required":
      return { text: "402", color: "text-yellow-400" };
    case "payment_created":
      return { text: "SIGNED", color: "text-blue-400" };
    case "payment_failed":
      return { text: "FAILED", color: "text-red-400" };
    case "status":
      return { text: "STATUS", color: "text-gray-400" };
    default:
      return { text: type.toUpperCase(), color: "text-gray-400" };
  }
}

export default function TransactionFeed() {
  const [events, setEvents] = useState<TxEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [x402Enabled, setX402Enabled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`${BACKEND}/v1/x402-feed/stream`);

    es.onopen = () => setConnected(true);

    es.onmessage = (msg) => {
      try {
        const evt: TxEvent = JSON.parse(msg.data);

        if (evt.type === "status") {
          setX402Enabled(!!evt.x402Enabled);
          return;
        }

        setEvents((prev) => [evt, ...prev].slice(0, 200));
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => es.close();
  }, []);

  // Auto-scroll on new events
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden flex flex-col max-h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">x402 Transaction Feed</span>
          <span className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-0.5 rounded ${x402Enabled ? "bg-green-900 text-green-300" : "bg-gray-700 text-gray-400"}`}>
            {x402Enabled ? "x402 ACTIVE" : "x402 INACTIVE"}
          </span>
          <span className="text-xs text-gray-500">{events.length} events</span>
        </div>
      </div>

      {/* Event list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto divide-y divide-gray-800">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
            Waiting for x402 payment events…
          </div>
        ) : (
          events.map((evt, i) => {
            const label = typeLabel(evt.type);
            return (
              <div key={`${evt.timestamp}-${i}`} className="px-4 py-2 hover:bg-gray-800/50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-mono font-bold ${label.color} w-16`}>{label.text}</span>
                  <span className="text-xs text-gray-400 font-mono w-20">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="text-xs text-gray-300 truncate flex-1">
                    {evt.method && evt.path
                      ? `${evt.method} ${evt.path}`
                      : evt.agentName || evt.agentId || "—"}
                  </span>
                  {evt.amount && evt.amount !== "0" && (
                    <span className="text-xs text-green-300 font-mono">
                      {(parseInt(evt.amount) / 1_000_000).toFixed(4)} USDC
                    </span>
                  )}
                </div>
                {evt.txSignature && (
                  <div className="ml-[76px] mt-0.5">
                    <a
                      href={`https://explorer.solana.com/tx/${evt.txSignature}${evt.network?.includes("devnet") ? "?cluster=devnet" : ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 font-mono"
                    >
                      tx: {shortenAddr(evt.txSignature)}
                    </a>
                    {evt.payer && (
                      <span className="text-xs text-gray-500 ml-3 font-mono">
                        from {shortenAddr(evt.payer)}
                      </span>
                    )}
                  </div>
                )}
                {evt.error && (
                  <div className="ml-[76px] mt-0.5 text-xs text-red-400">{evt.error}</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
