import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getPlatformOverview,
  getCostAnalytics,
  getPerformanceMetrics,
  getFailureAnalytics,
  getTopSpenders,
  getTopEarners,
  PlatformOverview,
  CostAnalytics,
  PerformanceMetrics,
  FailureAnalytics,
} from "../lib/api";
import {
  StatCard,
  LineChart,
  DualAxisChart,
  BarChart,
  DonutChart,
  Sparkline,
} from "../components/Charts";
import Layout from "../components/Layout";

type AgentSpendReport = {
  agentId: string;
  name: string | null;
  totalSpentLamports: number;
  totalCalls: number;
};

type AgentRevenueReport = {
  agentId: string;
  name: string | null;
  totalEarnedLamports: number;
  totalCalls: number;
};

function formatLamports(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  if (sol >= 0.01) return `${sol.toFixed(4)} SOL`;
  if (lamports >= 1000) return `${(lamports / 1000).toFixed(1)}K`;
  return lamports.toString();
}

export default function Analytics() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [costs, setCosts] = useState<CostAnalytics | null>(null);
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null);
  const [failures, setFailures] = useState<FailureAnalytics | null>(null);
  const [topSpenders, setTopSpenders] = useState<AgentSpendReport[]>([]);
  const [topEarners, setTopEarners] = useState<AgentRevenueReport[]>([]);
  const [period, setPeriod] = useState<"hour" | "day" | "week">("day");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [ov, co, perf, fail, spend, earn] = await Promise.all([
          getPlatformOverview().catch(() => null),
          getCostAnalytics(period).catch(() => null),
          getPerformanceMetrics(period).catch(() => null),
          getFailureAnalytics(period).catch(() => null),
          getTopSpenders(5).catch(() => []),
          getTopEarners(5).catch(() => []),
        ]);
        setOverview(ov);
        setCosts(co);
        setPerformance(perf);
        setFailures(fail);
        setTopSpenders(spend);
        setTopEarners(earn);
      } catch (error) {
        console.error("Failed to load analytics:", error);
      }
      setLoading(false);
    }
    loadData();
  }, [period]);

  return (
    <Layout title="Analytics">
      {/* Period Selector */}
      <div className="flex gap-2 mb-6">
        {(["hour", "day", "week"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
              period === p
                ? "bg-white text-zinc-900 border-white"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700"
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-zinc-600">Loading analytics...</div>
      ) : (
        <>
          {/* Platform Overview */}
          <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 mb-6">
            <h2 className="text-[17px] font-semibold text-white mb-4">Platform Overview</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Agents"
                value={overview?.totalAgents || 0}
                subtitle={`${overview?.activeAgents24h || 0} active (24h)`}
              />
              <StatCard
                title="Total Calls"
                value={overview?.totalCallsAllTime?.toLocaleString() || "0"}
                subtitle={`${overview?.totalCalls24h?.toLocaleString() || 0} today`}
              />
              <StatCard
                title="Total Volume"
                value={formatLamports(overview?.totalVolumeLamports || 0)}
                subtitle={`${formatLamports(overview?.volume24hLamports || 0)} (24h)`}
              />
              <StatCard
                title="Platform Revenue"
                value={formatLamports(overview?.platformRevenueLamports || 0)}
                subtitle="From fees"
              />
            </div>
          </section>

          {/* Cost Analytics */}
          <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 mb-6">
            <h2 className="text-[17px] font-semibold text-white mb-4">Cost Analytics Over Time</h2>
            {costs && costs.timeSeries.length > 0 ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: "Total Cost", val: formatLamports(costs.totalCostLamports) },
                    { label: "Total Calls", val: costs.totalCalls.toLocaleString() },
                    { label: "Avg Cost/Call", val: formatLamports(costs.avgCostPerCall) },
                    { label: "Avg Tokens/Call", val: costs.avgTokensPerCall.toLocaleString() },
                  ].map((s) => (
                    <div key={s.label} className="text-center">
                      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{s.label}</div>
                      <div className="text-xl font-bold text-white">{s.val}</div>
                    </div>
                  ))}
                </div>
                <LineChart
                  data={costs.timeSeries}
                  height={250}
                  color="#a1a1aa"
                  formatValue={(v) => formatLamports(v)}
                />
              </>
            ) : (
              <div className="text-center py-8 text-zinc-600">No cost data available for this period</div>
            )}
          </section>

          {/* Performance Metrics */}
          <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 mb-6">
            <h2 className="text-[17px] font-semibold text-white mb-4">Performance Metrics</h2>
            {performance ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: "Avg Latency", val: `${performance.avgLatencyMs}ms` },
                    { label: "P95 Latency", val: `${performance.p95LatencyMs}ms` },
                    { label: "P99 Latency", val: `${performance.p99LatencyMs}ms` },
                    { label: "Error Rate", val: `${performance.errorRate.toFixed(2)}%`, color: performance.errorRate > 5 ? "text-red-400" : "text-emerald-400" },
                  ].map((s) => (
                    <div key={s.label} className="text-center">
                      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{s.label}</div>
                      <div className={`text-xl font-bold ${(s as any).color || "text-white"}`}>{s.val}</div>
                    </div>
                  ))}
                </div>
                {performance.timeSeries.length > 0 && (
                  <DualAxisChart data={performance.timeSeries} height={250} />
                )}
              </>
            ) : (
              <div className="text-center py-8 text-zinc-600">No performance data available</div>
            )}
          </section>

          {/* Failure Analytics */}
          <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 mb-6">
            <h2 className="text-[17px] font-semibold text-white mb-4">Failure Analytics</h2>
            {failures ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                  <h3 className="text-sm text-zinc-500 font-medium mb-3">Failure Summary</h3>
                  <div className="flex gap-8 mb-4">
                    <div className="text-center">
                      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total Failures</div>
                      <div className="text-xl font-bold text-white">{failures.totalFailures}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Failure Rate</div>
                      <div className={`text-xl font-bold ${failures.failureRate > 5 ? "text-red-400" : "text-emerald-400"}`}>
                        {failures.failureRate.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  {Object.keys(failures.failuresByType).length > 0 && (
                    <>
                      <h3 className="text-sm text-zinc-500 font-medium mb-3">Failures by Type</h3>
                      <DonutChart
                        data={Object.entries(failures.failuresByType).map(([label, value], i) => ({
                          label,
                          value,
                          color: ["#ef4444", "#f97316", "#eab308", "#84cc16", "#06b6d4"][i % 5],
                        }))}
                        size={180}
                        centerLabel="Total"
                        centerValue={failures.totalFailures}
                      />
                    </>
                  )}
                </div>
                <div>
                  <h3 className="text-sm text-zinc-500 font-medium mb-3">Recent Failures</h3>
                  {failures.recentFailures.length > 0 ? (
                    <div className="space-y-2">
                      {failures.recentFailures.slice(0, 5).map((f, i) => (
                        <div key={i} className="p-3 bg-zinc-800/30 rounded-lg">
                          <div className="text-red-400 text-sm font-medium">{f.errorType}</div>
                          <div className="text-zinc-600 text-xs font-mono">{f.agentId}</div>
                          <div className="text-zinc-400 text-xs mt-1">{f.errorMessage.slice(0, 50)}...</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-zinc-600 text-sm">No recent failures</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-zinc-600">No failure data available</div>
            )}
          </section>

          {/* Leaderboards */}
          <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
            <h2 className="text-[17px] font-semibold text-white mb-4">Leaderboards (7 days)</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <h3 className="text-sm text-zinc-500 font-medium mb-3">Top Spenders</h3>
                {topSpenders.length > 0 ? (
                  <BarChart
                    data={topSpenders.map((s, i) => ({
                      label: s.name || s.agentId.slice(0, 8),
                      value: s.totalSpentLamports,
                      color: ["#a1a1aa", "#71717a", "#52525b", "#3f3f46", "#27272a"][i],
                    }))}
                    height={200}
                  />
                ) : (
                  <div className="text-center py-6 text-zinc-600 text-sm">No data</div>
                )}
              </div>
              <div>
                <h3 className="text-sm text-zinc-500 font-medium mb-3">Top Earners</h3>
                {topEarners.length > 0 ? (
                  <BarChart
                    data={topEarners.map((e, i) => ({
                      label: e.name || e.agentId.slice(0, 8),
                      value: e.totalEarnedLamports,
                      color: ["#a1a1aa", "#71717a", "#52525b", "#3f3f46", "#27272a"][i],
                    }))}
                    height={200}
                  />
                ) : (
                  <div className="text-center py-6 text-zinc-600 text-sm">No data</div>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </Layout>
  );
}
