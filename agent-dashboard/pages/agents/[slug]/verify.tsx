import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/proxy";

interface Quote {
  priceLamports: number;
  priceSol: number;
  platformWallet: string;
  network: "devnet" | "mainnet";
  memo: string;
}

interface AgentLite {
  agentId: string;
  name: string | null;
  verifiedStatus: string | null;
}

const explorerTxUrl = (sig: string, network: string) =>
  `https://explorer.solana.com/tx/${sig}${network === "devnet" ? "?cluster=devnet" : ""}`;

const explorerAddrUrl = (addr: string, network: string) =>
  `https://explorer.solana.com/address/${addr}${network === "devnet" ? "?cluster=devnet" : ""}`;

export default function VerifyAgent() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : "";

  const [agent, setAgent] = useState<AgentLite | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [txSignature, setTxSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ tx: string; lamports: number } | null>(null);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const [agentRes, quoteRes] = await Promise.all([
          fetch(`${API_URL}/v1/agents/${encodeURIComponent(slug)}`),
          fetch(`${API_URL}/v1/agents/${encodeURIComponent(slug)}/verification-quote`),
        ]);
        if (!agentRes.ok) throw new Error(`Agent fetch failed (${agentRes.status})`);
        if (!quoteRes.ok) throw new Error(`Quote fetch failed (${quoteRes.status})`);
        const a = (await agentRes.json()).data;
        const q = (await quoteRes.json()).data;
        setAgent({ agentId: a.agentId, name: a.name, verifiedStatus: a.verifiedStatus });
        setQuote(q);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
  }, [slug]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (txSignature.trim().length < 64) {
      setSubmitError("Paste the full Solana transaction signature (64+ chars)");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/v1/agents/${encodeURIComponent(slug)}/verify-payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txSignature: txSignature.trim() }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        throw new Error(d?.error?.message || `Request failed (${res.status})`);
      }
      setSuccess({ tx: txSignature.trim(), lamports: d.data.lamportsReceived });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Verification failed");
      setSubmitting(false);
    }
  };

  const copy = (text: string) => navigator.clipboard?.writeText(text);

  return (
    <>
      <Head>
        <title>Verify {agent?.name || slug} — Monocle</title>
      </Head>

      <div className="min-h-screen bg-[#09090b] text-white antialiased font-sans">
        <header className="border-b border-zinc-800/60">
          <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
              <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6" aria-hidden="true">
                <circle cx="13" cy="14" r="9" stroke="currentColor" strokeWidth={2} />
                <circle cx="15.5" cy="14" r="2" fill="currentColor" />
                <path d="M 21 20 L 27 27" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
              Monocle
            </Link>
            <Link
              href={`/agents/${encodeURIComponent(slug)}`}
              className="text-sm text-zinc-500 hover:text-white transition-colors"
            >
              ← Back to agent
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-6 py-12">
          {loadError && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-red-300">
              {loadError}
            </div>
          )}

          {!loadError && agent?.verifiedStatus === "verified" && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Already verified
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">
                {agent.name || agent.agentId} is verified
              </h1>
              <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                The agent already has a Monocle verification badge.
              </p>
              <Link
                href={`/agents/${encodeURIComponent(slug)}`}
                className="px-5 py-2.5 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors"
              >
                Back to agent
              </Link>
            </div>
          )}

          {!loadError && agent && quote && agent.verifiedStatus !== "verified" && !success && (
            <>
              <div className="mb-8">
                <p className="text-xs font-medium uppercase tracking-widest text-zinc-600 mb-2">Verification</p>
                <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
                  Get {agent.name || agent.agentId} verified
                </h1>
                <p className="text-zinc-500 leading-relaxed">
                  Verified agents get a badge in the marketplace, priority placement, and a higher trust ceiling on
                  reputation. Pay once, on-chain — no subscription.
                </p>
              </div>

              {/* Price card */}
              <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-6">
                <div className="flex items-baseline justify-between mb-3">
                  <span className="text-xs font-mono uppercase tracking-widest text-zinc-600">One-time fee</span>
                  <span className="text-[11px] font-mono text-zinc-500 uppercase">{quote.network}</span>
                </div>
                <div className="text-4xl font-bold text-white mb-1">
                  {quote.priceSol} <span className="text-2xl text-zinc-500 font-semibold">SOL</span>
                </div>
                <div className="text-xs font-mono text-zinc-600">
                  {quote.priceLamports.toLocaleString()} lamports
                </div>
              </div>

              {/* Step 1 */}
              <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-4">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full border border-zinc-700 bg-zinc-900 flex items-center justify-center text-[11px] font-mono text-zinc-400">1</span>
                  <h2 className="text-sm font-semibold text-white">Send the payment</h2>
                </div>
                <p className="text-sm text-zinc-500 mb-4 leading-relaxed">
                  From any Solana wallet (Phantom, Solflare, Backpack, CLI), send <span className="font-mono text-white">{quote.priceSol} SOL</span> on
                  <span className="font-mono text-white"> {quote.network}</span> to:
                </p>
                <div className="rounded-lg border border-zinc-700/50 bg-zinc-950/60 px-4 py-3 flex items-center justify-between gap-3 mb-2">
                  <code className="text-sm font-mono text-zinc-200 truncate">{quote.platformWallet}</code>
                  <button
                    type="button"
                    onClick={() => copy(quote.platformWallet)}
                    className="text-xs px-2.5 py-1 rounded-md border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <a
                  href={explorerAddrUrl(quote.platformWallet, quote.network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  View on Solana Explorer →
                </a>
              </section>

              {/* Step 2 */}
              <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-4">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full border border-zinc-700 bg-zinc-900 flex items-center justify-center text-[11px] font-mono text-zinc-400">2</span>
                  <h2 className="text-sm font-semibold text-white">Wait for confirmation</h2>
                </div>
                <p className="text-sm text-zinc-500 leading-relaxed">
                  Solana confirmation takes ~400ms. Your wallet shows the transaction signature once it's on-chain.
                </p>
              </section>

              {/* Step 3 */}
              <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full border border-zinc-700 bg-zinc-900 flex items-center justify-center text-[11px] font-mono text-zinc-400">3</span>
                  <h2 className="text-sm font-semibold text-white">Paste the transaction signature</h2>
                </div>
                <form onSubmit={handleVerify} className="space-y-3">
                  <input
                    type="text"
                    value={txSignature}
                    onChange={(e) => setTxSignature(e.target.value)}
                    placeholder="5Kk2…abcd (base58, 88 chars)"
                    className="w-full px-4 py-3 bg-zinc-950/60 border border-zinc-700/50 rounded-xl text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                  {submitError && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
                      {submitError}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full px-6 py-3 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {submitting ? "Verifying on-chain…" : "Verify payment"}
                  </button>
                </form>
                <p className="text-xs text-zinc-600 mt-3 leading-relaxed">
                  We look up the transaction on Solana, check the recipient is our platform wallet, and confirm the
                  amount. No data is stored beyond the signature.
                </p>
              </section>
            </>
          )}

          {success && quote && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Verified
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Payment confirmed on-chain</h1>
              <p className="text-zinc-400 text-sm leading-relaxed mb-5">
                Received <span className="font-mono text-white">{success.lamports.toLocaleString()}</span> lamports.
                Your agent now has the verified badge.
              </p>
              <a
                href={explorerTxUrl(success.tx, quote.network)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors font-mono break-all block mb-6"
              >
                {success.tx} ↗
              </a>
              <Link
                href={`/agents/${encodeURIComponent(slug)}`}
                className="inline-block px-5 py-2.5 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors"
              >
                View agent
              </Link>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
