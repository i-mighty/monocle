import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/proxy";

interface ReputationComponent {
  value: number | null;
  sampleSize: number;
  contribution: number;
}

interface ReputationBreakdown {
  agentId: string;
  score: number;
  baseline: number;
  components: {
    successRate30d: ReputationComponent;
    endpointUptime: ReputationComponent;
    settlementOk: ReputationComponent;
    tenureBonus: { ageDays: number; contribution: number };
    recentActivity: { callsLast7d: number; contribution: number };
  };
  computedAt: string;
}

interface AgentDetail {
  agentId: string;
  name: string | null;
  publicKey: string | null;
  ratePer1kTokens: number;
  categories?: string[];
  bio?: string | null;
  verifiedStatus?: string | null;
  verifiedAt?: string | null;
  solName?: string | null;
  endpointUrl?: string | null;
  endpointHealthy?: boolean | null;
  reputation?: ReputationBreakdown | null;
  balanceLamports: number;
  pendingLamports: number;
  createdAt: string;
}

const TASK_TYPE_LABELS: Record<string, string> = {
  code: "Code",
  research: "Research",
  reasoning: "Reasoning",
  writing: "Writing",
  math: "Math",
  translation: "Translation",
  image: "Image",
  audio: "Audio",
  general: "General",
};

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

interface SettleResult {
  agentId: string;
  grossLamports: number;
  platformFeeLamports: number;
  netLamports: number;
  txSignature: string;
  explorerUrl: string;
  status: string;
}

export default function AgentProfile() {
  const router = useRouter();
  const { slug } = router.query;
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Settle-now state
  const [settling, setSettling] = useState(false);
  const [settleResult, setSettleResult] = useState<SettleResult | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  const refreshAgent = async () => {
    if (typeof slug !== "string") return;
    try {
      const res = await fetch(`${API_URL}/v1/agents/${encodeURIComponent(slug)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) setAgent(data.data);
    } catch {}
  };

  const handleSettle = async () => {
    if (typeof slug !== "string") return;
    setSettling(true);
    setSettleError(null);
    setSettleResult(null);
    try {
      const res = await fetch(`${API_URL}/v1/agents/${encodeURIComponent(slug)}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
      }
      setSettleResult(data.data as SettleResult);
      // Refresh agent so balances and reputation update without a manual reload
      await refreshAgent();
    } catch (err) {
      setSettleError(err instanceof Error ? err.message : "Settle failed");
    } finally {
      setSettling(false);
    }
  };

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

  const verified = agent?.verifiedStatus === "verified";

  return (
    <>
      <Head>
        <title>{agent ? `${agent.name || agent.agentId} — Monocle` : "Agent — Monocle"}</title>
      </Head>

      <div className="min-h-screen bg-[#09090b] text-white antialiased font-sans">
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
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h1 className="text-3xl font-bold text-white tracking-tight truncate">
                        {agent.name || agent.agentId}
                      </h1>
                      {verified && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-medium"
                          title="Verified by Monocle"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                            <path d="M9 12l2 2 4-4" />
                            <circle cx="12" cy="12" r="9" />
                          </svg>
                          Verified
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-mono text-zinc-500 mb-4">
                      {agent.solName ? `${agent.solName} · ` : ""}
                      {agent.agentId}
                    </p>
                    {agent.bio && (
                      <p className="text-sm text-zinc-400 leading-relaxed mb-4 max-w-prose">{agent.bio}</p>
                    )}
                    {agent.categories && agent.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {agent.categories.map((c) => (
                          <span
                            key={c}
                            className="px-2.5 py-1 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-300 text-xs font-medium"
                          >
                            {TASK_TYPE_LABELS[c] ?? c}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-zinc-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Registered {formatRelative(agent.createdAt)}
                    </div>
                  </div>
                </div>
              </section>

              {/* Settle CTA — only when there's a pending balance and the agent has a wallet to receive it */}
              {agent.pendingLamports > 0 && agent.publicKey && !settleResult && (
                <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-6 flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-[260px]">
                    <h2 className="text-sm font-semibold text-white mb-1">Settle pending earnings</h2>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      {formatLamports(agent.pendingLamports)} ready to settle. Sends real SOL on-chain to{" "}
                      <span className="font-mono text-zinc-400">{agent.publicKey.slice(0, 6)}…{agent.publicKey.slice(-4)}</span>{" "}
                      after Monocle's 5% fee.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSettle}
                    disabled={settling}
                    className="px-5 py-2.5 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                  >
                    {settling ? "Settling on-chain…" : "Settle now →"}
                  </button>
                </section>
              )}

              {/* Settle error */}
              {settleError && !settleResult && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300 mb-6">
                  ✗ {settleError}
                </div>
              )}

              {/* Settle success — sticky until user dismisses */}
              {settleResult && (
                <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Settled on-chain
                    </div>
                    <button
                      type="button"
                      onClick={() => { setSettleResult(null); setSettleError(null); }}
                      className="text-xs text-zinc-500 hover:text-white transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-4">
                    {formatLamports(settleResult.netLamports)} transferred to {agent.name || agent.agentId}
                  </h3>
                  <dl className="grid sm:grid-cols-3 gap-4 text-sm mb-5">
                    <div>
                      <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">Gross</dt>
                      <dd className="font-mono text-zinc-200">{settleResult.grossLamports.toLocaleString()} lamports</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">Monocle fee (5%)</dt>
                      <dd className="font-mono text-zinc-200">{settleResult.platformFeeLamports.toLocaleString()} lamports</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">Net to agent</dt>
                      <dd className="font-mono text-white font-semibold">{settleResult.netLamports.toLocaleString()} lamports</dd>
                    </div>
                  </dl>
                  <a
                    href={settleResult.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-white transition-colors font-mono break-all"
                  >
                    tx {settleResult.txSignature.slice(0, 8)}…{settleResult.txSignature.slice(-8)} ↗
                  </a>
                </section>
              )}

              {/* Verify CTA — only when not verified */}
              {!verified && (
                <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-6 flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-[260px]">
                    <h2 className="text-sm font-semibold text-white mb-1">Get verified</h2>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      Pay a one-time on-chain fee to mint a verification badge. Verified agents rank higher in
                      marketplace listings.
                    </p>
                  </div>
                  <Link
                    href={`/agents/${encodeURIComponent(agent.agentId)}/verify`}
                    className="px-5 py-2.5 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors whitespace-nowrap"
                  >
                    Pay & verify →
                  </Link>
                </section>
              )}

              {/* Stats */}
              <div className="grid sm:grid-cols-3 gap-4 mb-6">
                <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-5">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">Default rate</div>
                  <div className="text-xl font-semibold text-white">{agent.ratePer1kTokens.toLocaleString()}</div>
                  <div className="text-xs text-zinc-500 mt-1">lamports / 1k tokens</div>
                </div>
                <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-5">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">Balance</div>
                  <div className="text-xl font-semibold text-white">{formatLamports(agent.balanceLamports)}</div>
                  <div className="text-xs text-zinc-500 mt-1">available to settle</div>
                </div>
                <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-5">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">Pending</div>
                  <div className="text-xl font-semibold text-white">{formatLamports(agent.pendingLamports)}</div>
                  <div className="text-xs text-zinc-500 mt-1">queued for settlement</div>
                </div>
              </div>

              {/* Identity */}
              <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-6">
                <h2 className="text-sm font-semibold text-white mb-4">Identity</h2>
                <dl className="space-y-4">
                  <div>
                    <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-1.5">Solana public key</dt>
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

              {/* Endpoint */}
              <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-white">Endpoint</h2>
                  {agent.endpointUrl && (
                    <span
                      className={[
                        "inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-md border",
                        agent.endpointHealthy === true
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : agent.endpointHealthy === false
                          ? "border-red-500/30 bg-red-500/10 text-red-300"
                          : "border-zinc-700 bg-zinc-900/50 text-zinc-500",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "w-1.5 h-1.5 rounded-full",
                          agent.endpointHealthy === true
                            ? "bg-emerald-500 animate-pulse"
                            : agent.endpointHealthy === false
                            ? "bg-red-500"
                            : "bg-zinc-500",
                        ].join(" ")}
                      />
                      {agent.endpointHealthy === true ? "healthy" : agent.endpointHealthy === false ? "unhealthy" : "not checked"}
                    </span>
                  )}
                </div>
                {agent.endpointUrl ? (
                  <a
                    href={agent.endpointUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-mono text-zinc-300 hover:text-white break-all transition-colors"
                  >
                    {agent.endpointUrl} ↗
                  </a>
                ) : (
                  <p className="text-sm text-zinc-600 italic">
                    No endpoint configured. Set one in <Link href={`/agents/${encodeURIComponent(agent.agentId)}/edit`} className="text-zinc-400 underline hover:text-white">edit</Link> so callers can reach this agent and the marketplace can list it.
                  </p>
                )}
              </section>

              {/* Reputation breakdown */}
              {agent.reputation && (
                <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 mb-6">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-sm font-semibold text-white">Reputation</h2>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold text-white">{agent.reputation.score}</span>
                      <span className="text-xs font-mono text-zinc-600">/1000</span>
                    </div>
                  </div>

                  {/* Score bar */}
                  <div className="mb-6">
                    <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={[
                          "h-full rounded-full transition-all",
                          agent.reputation.score >= 750
                            ? "bg-emerald-500"
                            : agent.reputation.score >= 500
                            ? "bg-zinc-300"
                            : agent.reputation.score >= 250
                            ? "bg-amber-500"
                            : "bg-red-500",
                        ].join(" ")}
                        style={{ width: `${(agent.reputation.score / 1000) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-zinc-600 mt-1.5">
                      <span>0</span>
                      <span>baseline 500</span>
                      <span>1000</span>
                    </div>
                  </div>

                  {/* Components */}
                  <dl className="grid sm:grid-cols-2 gap-4 text-sm">
                    {/* Success rate */}
                    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4">
                      <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-1.5">
                        Success rate · 30d
                      </dt>
                      <dd className="text-lg font-semibold text-white">
                        {agent.reputation.components.successRate30d.value === null
                          ? <span className="text-zinc-600">no data</span>
                          : `${(agent.reputation.components.successRate30d.value * 100).toFixed(1)}%`}
                      </dd>
                      <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                        {agent.reputation.components.successRate30d.sampleSize} reported calls ·
                        <span className={agent.reputation.components.successRate30d.contribution >= 0 ? " text-emerald-400" : " text-red-400"}>
                          {" "}{agent.reputation.components.successRate30d.contribution >= 0 ? "+" : ""}{agent.reputation.components.successRate30d.contribution}
                        </span>
                      </p>
                    </div>

                    {/* Endpoint uptime */}
                    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4">
                      <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-1.5">
                        Endpoint uptime
                      </dt>
                      <dd className="text-lg font-semibold text-white">
                        {agent.reputation.components.endpointUptime.value === null
                          ? <span className="text-zinc-600">no data</span>
                          : `${(agent.reputation.components.endpointUptime.value * 100).toFixed(1)}%`}
                      </dd>
                      <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                        {agent.reputation.components.endpointUptime.sampleSize} health checks ·
                        <span className={agent.reputation.components.endpointUptime.contribution >= 0 ? " text-emerald-400" : " text-red-400"}>
                          {" "}{agent.reputation.components.endpointUptime.contribution >= 0 ? "+" : ""}{agent.reputation.components.endpointUptime.contribution}
                        </span>
                      </p>
                    </div>

                    {/* Settlement reliability */}
                    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4">
                      <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-1.5">
                        Settlement reliability
                      </dt>
                      <dd className="text-lg font-semibold text-white">
                        {agent.reputation.components.settlementOk.value === null
                          ? <span className="text-zinc-600">no data</span>
                          : `${(agent.reputation.components.settlementOk.value * 100).toFixed(1)}%`}
                      </dd>
                      <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                        {agent.reputation.components.settlementOk.sampleSize} settlements ·
                        <span className={agent.reputation.components.settlementOk.contribution >= 0 ? " text-emerald-400" : " text-red-400"}>
                          {" "}{agent.reputation.components.settlementOk.contribution >= 0 ? "+" : ""}{agent.reputation.components.settlementOk.contribution}
                        </span>
                      </p>
                    </div>

                    {/* Tenure + recent activity rolled into one */}
                    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4">
                      <dt className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-1.5">
                        Tenure & activity
                      </dt>
                      <dd className="text-lg font-semibold text-white">
                        {agent.reputation.components.tenureBonus.ageDays.toFixed(0)}d old
                      </dd>
                      <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                        {agent.reputation.components.recentActivity.callsLast7d} calls last 7d ·
                        <span className="text-emerald-400"> +{agent.reputation.components.tenureBonus.contribution + agent.reputation.components.recentActivity.contribution}</span>
                      </p>
                    </div>
                  </dl>

                  <p className="text-[10px] font-mono text-zinc-600 mt-4">
                    Baseline {agent.reputation.baseline}. Recomputed every 10 min, plus on every reported call.
                  </p>
                </section>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/agents/${encodeURIComponent(agent.agentId)}/edit`}
                  className="px-5 py-2.5 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors"
                >
                  Edit agent
                </Link>
                <Link
                  href="/marketplace"
                  className="px-5 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 font-semibold text-sm hover:text-white hover:border-zinc-700 transition-colors"
                >
                  Back to marketplace
                </Link>
              </div>
              <p className="text-xs text-zinc-600 mt-3">
                Policy controls (spend caps, allowlist, pause) are coming next session.
              </p>
            </>
          )}
        </main>
      </div>
    </>
  );
}
