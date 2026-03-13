/**
 * Agent Profile Page
 *
 * Public page showing agent details, performance stats, and task breakdown.
 * URL: /agents/[agentId]
 */

import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getAgentStats,
  AgentStatsResponse,
  AgentProfile,
  PerformanceStats,
  TaskBreakdown,
} from "../../lib/agent-api";

// =============================================================================
// COMPONENTS
// =============================================================================

function StatCard({ label, value, subtext, color = "#3b82f6" }: {
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
}) {
  return (
    <div style={{
      background: "#1e1e2e",
      borderRadius: 12,
      padding: 20,
      borderTop: `3px solid ${color}`
    }}>
      <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>{value}</div>
      {subtext && <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>{subtext}</div>}
    </div>
  );
}

function LatencyBar({ label, value, maxValue }: {
  label: string;
  value: number;
  maxValue: number;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  const color = value < 500 ? "#22c55e" : value < 1000 ? "#eab308" : "#ef4444";

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: "#888", fontSize: 12 }}>{label}</span>
        <span style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{value}ms</span>
      </div>
      <div style={{ background: "#2a2a3a", borderRadius: 4, height: 8, overflow: "hidden" }}>
        <div style={{
          width: `${Math.min(pct, 100)}%`,
          height: "100%",
          background: color,
          borderRadius: 4
        }} />
      </div>
    </div>
  );
}

function TaskTypeCard({ task }: { task: TaskBreakdown }) {
  const colors: Record<string, string> = {
    code: "#f97316",
    research: "#22c55e",
    reasoning: "#a78bfa",
    writing: "#3b82f6",
    math: "#eab308",
    translation: "#06b6d4",
    image: "#ec4899",
    audio: "#8b5cf6",
    general: "#6b7280"
  };

  return (
    <div style={{
      background: "#1e1e2e",
      borderRadius: 8,
      padding: 16,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: colors[task.taskType] || "#6b7280",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18
        }}>
          {task.taskType === "code" && "💻"}
          {task.taskType === "research" && "🔍"}
          {task.taskType === "reasoning" && "🧠"}
          {task.taskType === "writing" && "✍️"}
          {task.taskType === "math" && "📐"}
          {task.taskType === "translation" && "🌐"}
          {task.taskType === "image" && "🖼️"}
          {task.taskType === "audio" && "🎵"}
          {task.taskType === "general" && "⚡"}
        </div>
        <div>
          <div style={{ color: "#fff", fontWeight: 600, textTransform: "capitalize" }}>
            {task.taskType}
          </div>
          <div style={{ color: "#666", fontSize: 12 }}>
            {task.count.toLocaleString()} requests
          </div>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{
          color: parseFloat(task.successRate) >= 95 ? "#22c55e" :
                 parseFloat(task.successRate) >= 80 ? "#eab308" : "#ef4444",
          fontWeight: 600
        }}>
          {task.successRate}
        </div>
        <div style={{ color: "#666", fontSize: 12 }}>{task.avgLatencyMs}ms avg</div>
      </div>
    </div>
  );
}

function VerifiedBadge() {
  return (
    <span style={{
      background: "#22c55e",
      color: "#fff",
      padding: "4px 10px",
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      marginLeft: 8,
      display: "inline-flex",
      alignItems: "center",
      gap: 4
    }}>
      ✓ Verified
    </span>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function AgentProfilePage() {
  const router = useRouter();
  const { agentId } = router.query;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AgentStatsResponse | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!agentId || typeof agentId !== "string") return;
    loadData(agentId);
  }, [agentId, days]);

  const loadData = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAgentStats(id, days);
      setData(result);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  if (!agentId) return null;

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d14", color: "#fff" }}>
      {/* Header */}
      <div style={{
        background: "#1e1e2e",
        padding: "16px 24px",
        borderBottom: "1px solid #333"
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ color: "#888", textDecoration: "none" }}>
            ← Back
          </Link>
          <div style={{ color: "#333" }}>|</div>
          <h1 style={{ margin: 0, fontSize: 18 }}>Agent Profile</h1>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 60, color: "#888" }}>
            Loading agent data...
          </div>
        )}

        {error && (
          <div style={{
            background: "#7f1d1d",
            border: "1px solid #ef4444",
            borderRadius: 12,
            padding: 20,
            color: "#fca5a5"
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Error loading agent</div>
            <div>{error}</div>
          </div>
        )}

        {data && (
          <>
            {/* Agent Header */}
            <div style={{
              background: "#1e1e2e",
              borderRadius: 16,
              padding: 32,
              marginBottom: 24,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start"
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                  <h2 style={{ margin: 0, fontSize: 32, fontWeight: 700 }}>
                    {data.agent.name}
                  </h2>
                  {data.agent.verified && <VerifiedBadge />}
                </div>
                <div style={{ color: "#888", fontSize: 14, marginBottom: 16 }}>
                  <code style={{ background: "#2a2a3a", padding: "2px 8px", borderRadius: 4 }}>
                    {data.agent.id}
                  </code>
                </div>
                {data.agent.bio && (
                  <p style={{ color: "#ccc", maxWidth: 600, lineHeight: 1.6, margin: "0 0 16px" }}>
                    {data.agent.bio}
                  </p>
                )}
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {data.agent.taskTypes.map((type) => (
                    <span key={type} style={{
                      background: "#2a2a3a",
                      padding: "6px 12px",
                      borderRadius: 20,
                      fontSize: 13,
                      textTransform: "capitalize"
                    }}>
                      {type}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Rate</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#22c55e" }}>
                  {data.agent.ratePer1kTokens.toLocaleString()}
                </div>
                <div style={{ color: "#666", fontSize: 12 }}>lamports / 1K tokens</div>
                {data.agent.websiteUrl && (
                  <a
                    href={data.agent.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-block",
                      marginTop: 16,
                      color: "#3b82f6",
                      textDecoration: "none",
                      fontSize: 14
                    }}
                  >
                    Visit Website →
                  </a>
                )}
              </div>
            </div>

            {/* Time Period Selector */}
            <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ color: "#888" }}>Period:</span>
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  style={{
                    background: days === d ? "#3b82f6" : "#2a2a3a",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 16px",
                    color: "#fff",
                    fontSize: 14,
                    cursor: "pointer"
                  }}
                >
                  {d} days
                </button>
              ))}
            </div>

            {/* Stats Grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
              marginBottom: 24
            }}>
              <StatCard
                label="Total Requests"
                value={data.performance.totalRequests.toLocaleString()}
                subtext={`${days}-day period`}
                color="#3b82f6"
              />
              <StatCard
                label="Success Rate"
                value={data.performance.successRate}
                subtext={`${data.performance.successfulRequests.toLocaleString()} successful`}
                color={parseFloat(data.performance.successRate) >= 95 ? "#22c55e" : "#eab308"}
              />
              <StatCard
                label="Uptime"
                value={data.performance.uptimePercent}
                color="#a78bfa"
              />
              <StatCard
                label="Reputation"
                value={data.agent.reputationScore}
                subtext="/ 1000"
                color="#f97316"
              />
              <StatCard
                label="Tokens Processed"
                value={data.performance.totalTokensProcessed.toLocaleString()}
                color="#06b6d4"
              />
              <StatCard
                label="Total Earnings"
                value={`${data.performance.totalEarningsSol} SOL`}
                subtext={`${data.performance.totalEarningsLamports.toLocaleString()} lamports`}
                color="#22c55e"
              />
            </div>

            {/* Two Column Layout */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              {/* Latency */}
              <div style={{
                background: "#1e1e2e",
                borderRadius: 12,
                padding: 24
              }}>
                <h3 style={{ margin: "0 0 20px", color: "#fff" }}>Latency Distribution</h3>
                <LatencyBar
                  label="Average"
                  value={data.performance.latency.avgMs}
                  maxValue={data.performance.latency.p99Ms || 2000}
                />
                <LatencyBar
                  label="P50 (Median)"
                  value={data.performance.latency.p50Ms}
                  maxValue={data.performance.latency.p99Ms || 2000}
                />
                <LatencyBar
                  label="P95"
                  value={data.performance.latency.p95Ms}
                  maxValue={data.performance.latency.p99Ms || 2000}
                />
                <LatencyBar
                  label="P99"
                  value={data.performance.latency.p99Ms}
                  maxValue={data.performance.latency.p99Ms || 2000}
                />
              </div>

              {/* Activity */}
              <div style={{
                background: "#1e1e2e",
                borderRadius: 12,
                padding: 24
              }}>
                <h3 style={{ margin: "0 0 20px", color: "#fff" }}>Activity</h3>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ color: "#888", fontSize: 12 }}>Member Since</div>
                  <div style={{ color: "#fff", fontSize: 16 }}>
                    {new Date(data.agent.memberSince).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric"
                    })}
                  </div>
                </div>
                {data.performance.firstRequestAt && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ color: "#888", fontSize: 12 }}>First Request (in period)</div>
                    <div style={{ color: "#fff", fontSize: 14 }}>
                      {new Date(data.performance.firstRequestAt).toLocaleString()}
                    </div>
                  </div>
                )}
                {data.performance.lastRequestAt && (
                  <div>
                    <div style={{ color: "#888", fontSize: 12 }}>Last Request</div>
                    <div style={{ color: "#fff", fontSize: 14 }}>
                      {new Date(data.performance.lastRequestAt).toLocaleString()}
                    </div>
                  </div>
                )}
                {!data.performance.firstRequestAt && (
                  <div style={{ color: "#666", fontStyle: "italic" }}>
                    No requests in this period
                  </div>
                )}
              </div>
            </div>

            {/* Task Breakdown */}
            {data.taskBreakdown.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ margin: "0 0 16px", color: "#fff" }}>Task Breakdown</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                  {data.taskBreakdown.map((task) => (
                    <TaskTypeCard key={task.taskType} task={task} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
