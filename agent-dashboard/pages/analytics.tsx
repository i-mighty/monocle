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
    <main className="page">
      <header className="nav">
        <div className="brand">AgentPay Analytics</div>
        <div className="links">
          <Link href="/">Marketplace</Link>
          <Link href="/usage">Usage</Link>
          <Link href="/analytics" className="active">Analytics</Link>
          <Link href="/receipts">Receipts</Link>
        </div>
      </header>

      {/* Period Selector */}
      <div className="period-selector">
        <button onClick={() => setPeriod("hour")} className={period === "hour" ? "active" : ""}>
          Hour
        </button>
        <button onClick={() => setPeriod("day")} className={period === "day" ? "active" : ""}>
          Day
        </button>
        <button onClick={() => setPeriod("week")} className={period === "week" ? "active" : ""}>
          Week
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading analytics...</div>
      ) : (
        <>
          {/* Platform Overview */}
          <section className="card">
            <h2>Platform Overview</h2>
            <div className="stats-grid">
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
          <section className="card">
            <h2>Cost Analytics Over Time</h2>
            {costs && costs.timeSeries.length > 0 ? (
              <>
                <div className="stats-row">
                  <div className="stat">
                    <div className="label">Total Cost</div>
                    <div className="value">{formatLamports(costs.totalCostLamports)}</div>
                  </div>
                  <div className="stat">
                    <div className="label">Total Calls</div>
                    <div className="value">{costs.totalCalls.toLocaleString()}</div>
                  </div>
                  <div className="stat">
                    <div className="label">Avg Cost/Call</div>
                    <div className="value">{formatLamports(costs.avgCostPerCall)}</div>
                  </div>
                  <div className="stat">
                    <div className="label">Avg Tokens/Call</div>
                    <div className="value">{costs.avgTokensPerCall.toLocaleString()}</div>
                  </div>
                </div>
                <div className="chart-container">
                  <LineChart
                    data={costs.timeSeries}
                    height={250}
                    color="#3b82f6"
                    formatValue={(v) => formatLamports(v)}
                  />
                </div>
              </>
            ) : (
              <div className="empty">No cost data available for this period</div>
            )}
          </section>

          {/* Performance Metrics */}
          <section className="card">
            <h2>Performance Metrics</h2>
            {performance ? (
              <>
                <div className="stats-row">
                  <div className="stat">
                    <div className="label">Avg Latency</div>
                    <div className="value">{performance.avgLatencyMs}ms</div>
                  </div>
                  <div className="stat">
                    <div className="label">P95 Latency</div>
                    <div className="value">{performance.p95LatencyMs}ms</div>
                  </div>
                  <div className="stat">
                    <div className="label">P99 Latency</div>
                    <div className="value">{performance.p99LatencyMs}ms</div>
                  </div>
                  <div className="stat">
                    <div className="label">Error Rate</div>
                    <div className="value" style={{ color: performance.errorRate > 5 ? "#ef4444" : "#10b981" }}>
                      {performance.errorRate.toFixed(2)}%
                    </div>
                  </div>
                </div>
                {performance.timeSeries.length > 0 && (
                  <div className="chart-container">
                    <DualAxisChart data={performance.timeSeries} height={250} />
                  </div>
                )}
              </>
            ) : (
              <div className="empty">No performance data available</div>
            )}
          </section>

          {/* Failure Analytics */}
          <section className="card">
            <h2>Failure Analytics</h2>
            {failures ? (
              <div className="two-col">
                <div>
                  <h3>Failure Summary</h3>
                  <div className="stats-row">
                    <div className="stat">
                      <div className="label">Total Failures</div>
                      <div className="value">{failures.totalFailures}</div>
                    </div>
                    <div className="stat">
                      <div className="label">Failure Rate</div>
                      <div className="value" style={{ color: failures.failureRate > 5 ? "#ef4444" : "#10b981" }}>
                        {failures.failureRate.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  {Object.keys(failures.failuresByType).length > 0 && (
                    <>
                      <h3>Failures by Type</h3>
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
                  <h3>Recent Failures</h3>
                  {failures.recentFailures.length > 0 ? (
                    <ul className="failure-list">
                      {failures.recentFailures.slice(0, 5).map((f, i) => (
                        <li key={i}>
                          <span className="failure-type">{f.errorType}</span>
                          <span className="failure-agent">{f.agentId}</span>
                          <span className="failure-msg">{f.errorMessage.slice(0, 50)}...</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty">No recent failures</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="empty">No failure data available</div>
            )}
          </section>

          {/* Leaderboards */}
          <section className="card">
            <h2>Leaderboards (7 days)</h2>
            <div className="two-col">
              <div>
                <h3>Top Spenders</h3>
                {topSpenders.length > 0 ? (
                  <BarChart
                    data={topSpenders.map((s, i) => ({
                      label: s.name || s.agentId.slice(0, 8),
                      value: s.totalSpentLamports,
                      color: ["#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef"][i],
                    }))}
                    height={200}
                  />
                ) : (
                  <div className="empty">No data</div>
                )}
              </div>
              <div>
                <h3>Top Earners</h3>
                {topEarners.length > 0 ? (
                  <BarChart
                    data={topEarners.map((e, i) => ({
                      label: e.name || e.agentId.slice(0, 8),
                      value: e.totalEarnedLamports,
                      color: ["#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6"][i],
                    }))}
                    height={200}
                  />
                ) : (
                  <div className="empty">No data</div>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      <style jsx>{`
        .page {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }
        .nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 0;
          border-bottom: 1px solid #e5e7eb;
          margin-bottom: 24px;
        }
        .brand {
          font-size: 20px;
          font-weight: 600;
          color: #111827;
        }
        .links {
          display: flex;
          gap: 24px;
        }
        .links a {
          color: #6b7280;
          text-decoration: none;
        }
        .links a:hover,
        .links a.active {
          color: #3b82f6;
        }
        .period-selector {
          display: flex;
          gap: 8px;
          margin-bottom: 24px;
        }
        .period-selector button {
          padding: 8px 16px;
          border: 1px solid #e5e7eb;
          background: white;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        }
        .period-selector button:hover {
          background: #f9fafb;
        }
        .period-selector button.active {
          background: #3b82f6;
          color: white;
          border-color: #3b82f6;
        }
        .card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 24px;
        }
        .card h2 {
          margin: 0 0 20px;
          font-size: 18px;
          color: #111827;
        }
        .card h3 {
          margin: 16px 0 12px;
          font-size: 14px;
          color: #6b7280;
          font-weight: 500;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
        }
        .stats-row {
          display: flex;
          gap: 32px;
          margin-bottom: 20px;
        }
        .stat {
          text-align: center;
        }
        .stat .label {
          font-size: 12px;
          color: #6b7280;
          margin-bottom: 4px;
        }
        .stat .value {
          font-size: 24px;
          font-weight: 600;
          color: #111827;
        }
        .chart-container {
          margin-top: 20px;
        }
        .two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
        }
        .loading {
          text-align: center;
          padding: 60px;
          color: #6b7280;
        }
        .empty {
          text-align: center;
          padding: 40px;
          color: #9ca3af;
          font-style: italic;
        }
        .failure-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .failure-list li {
          padding: 12px;
          border-bottom: 1px solid #f3f4f6;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .failure-type {
          font-weight: 500;
          color: #ef4444;
        }
        .failure-agent {
          font-size: 12px;
          color: #6b7280;
        }
        .failure-msg {
          font-size: 13px;
          color: #374151;
        }
        @media (max-width: 768px) {
          .two-col {
            grid-template-columns: 1fr;
          }
          .stats-row {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </main>
  );
}
