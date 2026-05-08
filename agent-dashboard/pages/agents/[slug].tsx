import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/proxy";

interface AgentDetail {
  agentId: string;
  name: string | null;
  publicKey: string | null;
  ratePer1kTokens: number;
  balanceLamports: number;
  pendingLamports: number;
  createdAt: string;
}

const formatLamports = (n: number): string => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(4)} SOL`;
  return `${n.toLocaleString()} lamports`;
};

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

export default function AgentProfile() {
  const router = useRouter();
  const { slug } = router.query;
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug || typeof slug !== "string") return;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/agents/${encodeURIComponent(slug)}`);
        if (res.status === 404) {
          setError(`Agent "${slug}" was not found.`);
          return;
        }
        if (!res.ok) {
          throw new Error(`Backend responded ${res.status}`);
        }
        const data = await res.json();
        if (!data.success) {
          throw new Error(data?.error?.message || "Backend returned an error");
        }
        setAgent(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load agent");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  return (
    <>
      <Head>
        <title>{agent ? `${agent.name || agent.agentId} — Monocle` : "Agent — Monocle"}</title>
      </Head>

      <div className="min-h-screen bg-[#09090b] text-white antialiased font-sans">
        {/* Nav */}
        <header className="border-b border-zinc-800/60">
          <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
              <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6" aria-hidden="true">
                <circle cx="13" cy="14" r="9" stroke="currentColor" strokeWidth={2} />
                <circle cx="15.5" cy="14" r="2" fill="currentColor" />
                <path d="M 21 20 L 27 27" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
              Monocle
            </Link>
            <div className="flex items-center gap-5 text-sm">
              <Link href="/marketplace" className="text-zinc-500 hover:text-white transition-colors">Marketplace</Link>
              <Link href="/dashboard" className="text-zinc-500 hover:text-white transition-colors">Dashboard</Link>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-6 py-10">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-zinc-600 mb-6">
            <Link href="/marketplace" className="hover:text-zinc-400 transition-colors">Marketplace</Link>
            <span>/</span>
            <span className="font-mono text-zinc-400">{slug}</span>
          </div>

          {loading && (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-12 text-center text-zinc-500">
              Loading agent…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-10">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-red-400 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                Error
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Agent not found</h1>
              <p className="text-zinc-500 leading-relaxed mb-6">{error}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/marketplace"
                  className="px-5 py-2.5 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors"
                >
                  Browse marketplace
                </Link>
                <Link
                  href="/agents/register"
                  className="px-5 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 font-semibold text-sm hover:text-white hover:border-zinc-700 transition-colors"
                >
                  Register a new agent
                </Link>
              </div>
            </div>
          )}

          {!loading && agent && (
            <>
              {/* Header card */}
              <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-8 mb-6">
                <div className="flex items-start gap-5">
                  <div className="w-14 h-14 rounded-xl bg-zinc-800 border border-zinc-700/50 flex items-center justify-center text-xl font-bold text-white shrink-0">
                    {(agent.name || agent.agentId).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h1 className="text-3xl font-bold text-white tracking-tight mb-1 truncate">
                      {agent.name || agent.agentId}
                    </h1>
                    <p className="text-sm font-mono text-zinc-500 mb-4">{agent.agentId}</p>
                    <div className="flex items-center gap-2 text-xs text-zinc-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Registered {formatRelative(agent.createdAt)}
                    </div>
                  </div>
                </div>
              </section>

              {/* Stats grid */}
              <div className="grid sm:grid-cols-3 gap-4 mb-6">
                <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-5">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">
                    Default rate
                  </div>
                  <div className="text-xl font-semibold text-white">
                    {agent.ratePer1kTokens.toLocaleString()}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">lamports / 1k tokens</div>
                </div>

                <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-5">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">
                    Balance
                  </div>
                  <div className="text-xl font-semibold text-white">
                    {formatLamports(agent.balanceLamports)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">available to settle</div>
                </div>

                <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-5">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">
                    Pending
                  </div>
                  <div className="text-xl font-semibold text-white">
                    {formatLamports(agent.pendingLamports)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">queued for settlement</div>
                </div>
              </div>

              {/* Wallet / identity */}
              <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-6">
                <h2 className="text-sm font-semibold text-white mb-4">Identity</h2>
                <dl className="space-y-4">
                  <div>
                    <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-1.5">
                      Solana public key
                    </dt>
                    <dd className="text-sm font-mono text-zinc-300 break-all">
                      {agent.publicKey || (
                        <span className="text-zinc-600 italic font-sans">
                          Not configured. Add a Solana wallet for settlements.
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/deploy/${agent.agentId}`}
                  className="px-5 py-2.5 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors"
                >
                  Deploy
                </Link>
                <Link
                  href="/marketplace"
                  className="px-5 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 font-semibold text-sm hover:text-white hover:border-zinc-700 transition-colors"
                >
                  Back to marketplace
                </Link>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
