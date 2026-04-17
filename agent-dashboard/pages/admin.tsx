/**
 * Admin Dashboard - AI Router Analytics
 *
 * Visualizes routing performance, agent health, and cost metrics.
 * Requires admin authentication via X-Admin-Key header.
 */

import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import {
  getDashboardSummary,
  DashboardSummary,
  AgentStats,
  ClassificationStats,
  TaskTypeStats,
  FailureLog,
  getRecentFailures,
  explainRoutingDecision,
  RoutingExplanation
} from "../lib/admin-api";

// COMPONENTS

function StatCard({ title, value, subtitle }: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-5">
      <div className="text-zinc-500 text-xs mb-1">{title}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {subtitle && <div className="text-zinc-600 text-xs mt-1">{subtitle}</div>}
    </div>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="bg-zinc-800 rounded h-2 overflow-hidden">
      <div
        className="h-full bg-zinc-500 rounded transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function AgentTable({ agents }: { agents: AgentStats[] }) {
  const maxRequests = Math.max(...agents.map(a => a.totalRequests), 1);
  const th = "text-left px-3 py-2 text-zinc-500 text-xs font-medium";
  const td = "px-3 py-3 text-sm text-white";

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-800/60">
            <th className={th}>Agent</th>
            <th className={th}>Requests</th>
            <th className={th}>Success Rate</th>
            <th className={th}>Avg Latency</th>
            <th className={th}>Avg Tokens</th>
            <th className={th}>Total Cost</th>
            <th className={th}>Fallbacks</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.agentId} className="border-b border-zinc-800/40">
              <td className={td}>
                <code className="text-zinc-400">{agent.agentId}</code>
              </td>
              <td className={td}>
                <div className="mb-1">{agent.totalRequests.toLocaleString()}</div>
                <ProgressBar value={agent.totalRequests} max={maxRequests} />
              </td>
              <td className={td}>
                <span className={
                  agent.successRate >= 0.95 ? "text-emerald-500" :
                  agent.successRate >= 0.8 ? "text-amber-500" : "text-red-500"
                }>
                  {(agent.successRate * 100).toFixed(1)}%
                </span>
              </td>
              <td className={td}>{agent.avgLatencyMs}ms</td>
              <td className={td}>{agent.avgTokensUsed}</td>
              <td className={td}>
                <span className="text-emerald-500">
                  {(agent.totalCostLamports / 1e9).toFixed(6)} SOL
                </span>
              </td>
              <td className={td}>{agent.fallbackToCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassificationCard({ stats }: { stats: ClassificationStats }) {
  const total = stats.llmCount + stats.keywordCount;
  const llmPct = total > 0 ? (stats.llmCount / total) * 100 : 0;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">Classification Method</h3>

      <div className="flex gap-5 mb-4">
        <div className="flex-1">
          <div className="text-zinc-500 text-xs">LLM Router</div>
          <div className="text-2xl font-bold text-white">{stats.llmCount}</div>
          <div className="text-xs text-zinc-600">
            {(stats.llmSuccessRate * 100).toFixed(1)}% success • {stats.avgLlmLatencyMs}ms avg
          </div>
        </div>
        <div className="flex-1">
          <div className="text-zinc-500 text-xs">Keyword Fallback</div>
          <div className="text-2xl font-bold text-white">{stats.keywordCount}</div>
          <div className="text-xs text-zinc-600">
            {(stats.keywordSuccessRate * 100).toFixed(1)}% success • {stats.avgKeywordLatencyMs}ms avg
          </div>
        </div>
      </div>

      <div className="mb-2">
        <div className="flex justify-between mb-1">
          <span className="text-zinc-500 text-xs">LLM vs Keyword</span>
          <span className="text-zinc-500 text-xs">{llmPct.toFixed(0)}% LLM</span>
        </div>
        <div className="flex h-3 rounded-md overflow-hidden">
          <div className="bg-white" style={{ width: `${llmPct}%` }} />
          <div className="flex-1 bg-zinc-700" />
        </div>
      </div>
    </div>
  );
}

function TaskTypeChart({ taskTypes }: { taskTypes: TaskTypeStats[] }) {
  const maxCount = Math.max(...taskTypes.map(t => t.count), 1);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">Task Distribution</h3>
      {taskTypes.map((task) => (
        <div key={task.taskType} className="mb-3">
          <div className="flex justify-between mb-1">
            <span className="text-zinc-400 font-medium">{task.taskType}</span>
            <span className="text-zinc-600 text-xs">
              {task.count} • {task.avgLatencyMs}ms • {(task.avgCostLamports / 1000).toFixed(0)}k lamports
            </span>
          </div>
          <ProgressBar value={task.count} max={maxCount} />
        </div>
      ))}
    </div>
  );
}

function FailuresTable({ failures, onExplain }: {
  failures: FailureLog[];
  onExplain: (logId: string) => void;
}) {
  const th = "text-left px-3 py-2 text-zinc-500 text-xs font-medium";
  const td = "px-3 py-3 text-sm";

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">Recent Failures</h3>
      {failures.length === 0 ? (
        <div className="text-zinc-600 text-center py-5">No failures in this period ✓</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800/60">
                <th className={th}>Time</th>
                <th className={th}>Task</th>
                <th className={th}>Agent</th>
                <th className={th}>Error</th>
                <th className={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr key={f.logId} className="border-b border-zinc-800/40">
                  <td className={td}>
                    <span className="text-zinc-500 text-xs">
                      {new Date(f.createdAt).toLocaleString()}
                    </span>
                  </td>
                  <td className={td}>
                    <span className="bg-zinc-800 px-2 py-0.5 rounded text-xs text-zinc-400">
                      {f.taskType}
                    </span>
                  </td>
                  <td className={td}>
                    <code className="text-zinc-400 text-xs">{f.agentId}</code>
                  </td>
                  <td className={`${td} max-w-[300px]`}>
                    <span className="text-red-500 text-xs">
                      {f.errorMessage?.slice(0, 80)}
                      {f.errorMessage?.length > 80 ? "..." : ""}
                    </span>
                  </td>
                  <td className={td}>
                    <button
                      onClick={() => onExplain(f.logId)}
                      className="bg-white text-zinc-900 rounded px-2 py-1 text-xs font-medium hover:bg-zinc-200 transition-colors"
                    >
                      Explain
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExplainModal({ logId, onClose }: { logId: string; onClose: () => void }) {
  const [data, setData] = useState<RoutingExplanation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    explainRoutingDecision(logId)
      .then((res) => setData(res.explanation))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [logId]);

  const section = "bg-zinc-950 rounded-lg p-4 mb-4";
  const label = "text-zinc-500 text-[11px] uppercase tracking-wider mb-1";

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-6 max-w-[700px] w-[90%] max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between mb-5">
          <div>
            <h3 className="text-white font-semibold">Routing Decision</h3>
            {data && (
              <span className="text-zinc-600 text-xs">
                {new Date(data.createdAt).toLocaleString()} &bull; {data.logId.slice(0, 8)}...
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-500 text-xl hover:text-white transition-colors">✕</button>
        </div>

        {loading && <div className="text-zinc-500 text-center py-10">Loading...</div>}
        {error && <div className="text-red-500 py-5">Error: {error}</div>}

        {data && (
          <>
            {data.messagePreview && (
              <div className={section}>
                <div className={label}>User Message</div>
                <div className="text-white text-sm font-mono whitespace-pre-wrap">
                  &quot;{data.messagePreview}&quot;
                  {data.messageLength > 200 && (
                    <span className="text-zinc-600"> ...({data.messageLength} chars total)</span>
                  )}
                </div>
              </div>
            )}

            <div className={section}>
              <div className={label}>Task Classification</div>
              <div className="flex items-center gap-3 mt-2">
                <span className="bg-white text-zinc-900 px-3 py-1 rounded-full text-xs font-semibold">
                  {data.taskType}
                </span>
                <span className="text-zinc-500 text-sm">
                  via <strong className="text-white">
                    {data.classificationMethod === "llm" ? "LLM Router" : "Keyword Matching"}
                  </strong>
                </span>
                <span className={`text-sm ${
                  data.classificationConfidence >= 0.8 ? "text-emerald-500" :
                  data.classificationConfidence >= 0.5 ? "text-amber-500" : "text-red-500"
                }`}>
                  {Math.round(data.classificationConfidence * 100)}% confidence
                </span>
              </div>
            </div>

            <div className={section}>
              <div className={label}>Agent Selection</div>
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-emerald-500">✓</span>
                  <code className="text-white text-sm">{data.selectedAgent.id}</code>
                  {data.selectedAgent.score !== null && (
                    <span className="bg-zinc-800 px-2 py-0.5 rounded text-xs text-zinc-400">
                      Score: {data.selectedAgent.score.toFixed(2)}
                    </span>
                  )}
                </div>

                {data.alternativeAgents.length > 0 && (
                  <div>
                    <div className="text-zinc-600 text-xs mb-1.5">
                      Also considered ({data.alternativeAgents.length}):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {data.alternativeAgents.map((agent) => (
                        <code key={agent} className="bg-zinc-800 px-2 py-0.5 rounded text-xs text-zinc-500">
                          {agent}
                        </code>
                      ))}
                    </div>
                  </div>
                )}

                {data.alternativeAgents.length === 0 && (
                  <div className="text-zinc-600 text-xs">
                    No alternative agents available for this task type
                  </div>
                )}
              </div>
            </div>

            {data.fallbackUsed && (
              <div className="bg-red-950/50 border border-red-500/30 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚠️</span>
                  <div>
                    <div className="text-red-500 font-semibold text-sm">Fallback Used</div>
                    <div className="text-red-400/80 text-xs">
                      {data.failedAgentCount} agent(s) failed before this one succeeded.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className={`${section} border-l-4 ${data.success ? "border-emerald-500" : "border-red-500"}`}>
              <div className={label}>Result</div>
              <div className="mt-2">
                <div className={`text-base font-semibold mb-2 ${data.success ? "text-emerald-500" : "text-red-500"}`}>
                  {data.success ? "✓ Success" : "✗ Failed"}
                </div>

                {!data.success && data.errorMessage && (
                  <div className="bg-zinc-900 p-3 rounded mb-3">
                    <code className="text-red-500 text-xs">{data.errorMessage}</code>
                  </div>
                )}

                <div className="flex gap-6">
                  <div>
                    <div className="text-zinc-600 text-[11px]">Latency</div>
                    <div className="text-white text-sm">{data.latencyMs}ms</div>
                  </div>
                  <div>
                    <div className="text-zinc-600 text-[11px]">Tokens</div>
                    <div className="text-white text-sm">{data.tokensUsed.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-zinc-600 text-[11px]">Cost</div>
                    <div className="text-emerald-500 text-sm">{data.costLamports.toLocaleString()} lamports</div>
                  </div>
                </div>
              </div>
            </div>

            <div className={section}>
              <div className={label}>Analysis Summary</div>
              <div className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap mt-2">
                {data.summary}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [adminKey, setAdminKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [days, setDays] = useState(7);
  const [explainLogId, setExplainLogId] = useState<string | null>(null);

  // Check for stored key on mount (sessionStorage clears on tab close for security)
  useEffect(() => {
    const stored = sessionStorage.getItem("adminKey");
    if (stored) {
      setAdminKey(stored);
      setAuthenticated(true);
    }
  }, []);

  // Load data when authenticated
  useEffect(() => {
    if (!authenticated) return;
    loadData();
  }, [authenticated, days]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = await getDashboardSummary(days);
      setData(summary);
    } catch (err: any) {
      setError(err.message);
      if (err.message.includes("401") || err.message.includes("403")) {
        setAuthenticated(false);
        sessionStorage.removeItem("adminKey");
      }
    }
    setLoading(false);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminKey.trim()) return;
    sessionStorage.setItem("adminKey", adminKey);
    setAuthenticated(true);
  };

  const handleLogout = () => {
    sessionStorage.removeItem("adminKey");
    setAdminKey("");
    setAuthenticated(false);
    setData(null);
  };

  // Login screen
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <form onSubmit={handleLogin} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-8 w-[360px]">
          <h1 className="text-white text-2xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-zinc-500 text-sm mb-6">Enter your admin API key to access analytics</p>

          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Admin API Key"
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm mb-4 focus:outline-none focus:border-zinc-600 transition-colors"
          />

          <button type="submit" className="w-full py-3 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors">
            Sign In
          </button>

          {error && (
            <div className="text-red-500 mt-4 text-sm">{error}</div>
          )}
        </form>
      </div>
    );
  }

  // Dashboard
  return (
    <Layout title="Admin">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Admin Analytics</h1>
          <span className="text-zinc-500 text-xs">AI Router Performance</span>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="bg-zinc-900 border border-zinc-800/60 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-zinc-600"
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={loadData}
            disabled={loading}
            className={`px-4 py-2 bg-white text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors ${loading ? "opacity-50 cursor-wait" : ""}`}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2 border border-zinc-800/60 rounded-lg text-zinc-500 text-sm hover:text-white hover:border-zinc-600 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/50 border border-red-500/30 rounded-lg p-4 mb-6 text-red-500 text-sm">
          Error: {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              title="Total Requests"
              value={data.agents.reduce((sum, a) => sum + a.totalRequests, 0).toLocaleString()}
              subtitle={`${data.period}`}
            />
            <StatCard
              title="Success Rate"
              value={`${(
                (data.agents.reduce((sum, a) => sum + a.successCount, 0) /
                 Math.max(data.agents.reduce((sum, a) => sum + a.totalRequests, 0), 1)) * 100
              ).toFixed(1)}%`}
            />
            <StatCard
              title="Total Cost"
              value={`${(
                data.agents.reduce((sum, a) => sum + a.totalCostLamports, 0) / 1e9
              ).toFixed(4)} SOL`}
            />
            <StatCard
              title="LLM Classification"
              value={`${(
                (data.classification.llmCount /
                 Math.max(data.classification.llmCount + data.classification.keywordCount, 1)) * 100
              ).toFixed(0)}%`}
              subtitle={`${data.classification.avgLlmLatencyMs}ms avg latency`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <ClassificationCard stats={data.classification} />
            <TaskTypeChart taskTypes={data.taskTypes} />
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-5 mb-6">
            <h3 className="text-white font-semibold mb-4">Agent Performance</h3>
            <AgentTable agents={data.agents} />
          </div>

          <FailuresTable
            failures={data.recentFailures}
            onExplain={setExplainLogId}
          />
        </>
      )}

      {explainLogId && (
        <ExplainModal
          logId={explainLogId}
          onClose={() => setExplainLogId(null)}
        />
      )}
    </Layout>
  );
}
