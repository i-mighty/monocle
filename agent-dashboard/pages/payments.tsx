/**
 * x402 Payments Dashboard Page
 *
 * Shows the live x402 transaction feed and integration status.
 */

import Head from "next/head";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const TransactionFeed = dynamic(() => import("../components/TransactionFeed"), {
  ssr: false,
});

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

interface X402Status {
  x402Enabled: boolean;
  network: string;
  payTo: string | null;
  facilitator: string;
  chatPrice: string;
  clientConfigured: boolean;
}

export default function PaymentsPage() {
  const [status, setStatus] = useState<X402Status | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/v1/x402-feed/status`)
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  return (
    <>
      <Head>
        <title>x402 Payments — Monocle</title>
      </Head>
      <div className="min-h-screen bg-[#09090b] text-white">
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">x402 Payments</h1>
              <p className="text-zinc-500 text-sm mt-1">
                Real&ndash;time Solana USDC micropayments via the x402 protocol
              </p>
            </div>
            <a
              href="/"
              className="text-sm text-zinc-400 hover:text-white transition-colors"
            >
              &larr; Marketplace
            </a>
          </div>

          {/* Status cards */}
          {status && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatusCard
                label="x402 Status"
                value={status.x402Enabled ? "Active" : "Inactive"}
                active={status.x402Enabled}
              />
              <StatusCard label="Network" value={status.network} />
              <StatusCard
                label="Chat Price"
                value={`$${status.chatPrice} USDC`}
              />
              <StatusCard
                label="Paying Client"
                value={status.clientConfigured ? "Configured" : "Disabled"}
                active={status.clientConfigured}
              />
            </div>
          )}

          {/* Live feed */}
          <TransactionFeed />

          {/* Setup instructions if not configured */}
          {status && !status.x402Enabled && (
            <div className="bg-zinc-900/50 border border-amber-500/20 rounded-xl p-5 space-y-3">
              <h3 className="text-amber-400 font-semibold">
                x402 is not configured
              </h3>
              <p className="text-zinc-500 text-sm">
                To enable real x402 Solana USDC payments, add these to your{" "}
                <code className="bg-zinc-800 px-1 rounded">.env</code>:
              </p>
              <pre className="bg-[#0a0a0a] text-zinc-400 text-xs p-3 rounded-lg overflow-x-auto font-mono">
{`# Your Solana wallet address (receives USDC payments)
X402_PAY_TO=<your-solana-wallet-address>

# Network: devnet (testing) or mainnet
SOLANA_NETWORK=devnet

# Price per chat request in USDC
X402_CHAT_PRICE=0.001

# (Optional) Private key for agent-to-agent paying client
X402_CLIENT_PRIVATE_KEY=<base58-private-key>`}
              </pre>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StatusCard({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3">
      <div className="text-xs text-zinc-600 mb-1">{label}</div>
      <div className={`text-sm font-semibold ${active === true ? "text-emerald-400" : active === false ? "text-zinc-500" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}
