/**
 * Admin Dashboard - AI Router Analytics
 *
 * Visualizes routing performance, agent health, and cost metrics.
 * Requires admin authentication via X-Admin-Key header.
 */

import { useEffect, useState } from "react";
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

// =============================================================================
// COMPONENTS
// =============================================================================

function StatCard({ title, value, subtitle, color = "#3b82f6" }: {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div style={{
      background: "#1e1e2e",
      borderRadius: 12,
      padding: 20,
      borderLeft: `4px solid ${color}`
    }}>
      <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>{value}</div>
      {subtitle && <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function ProgressBar({ value, max, color = "#3b82f6" }: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ background: "#2a2a3a", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`,
        height: "100%",
        background: color,
        borderRadius: 4,
        transition: "width 0.3s ease"
      }} />
    </div>
  );
}

function AgentTable({ agents }: { agents: AgentStats[] }) {
  const maxRequests = Math.max(...agents.map(a => a.totalRequests), 1);
  
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #333" }}>
            <th style={thStyle}>Agent</th>
            <th style={thStyle}>Requests</th>
            <th style={thStyle}>Success Rate</th>
            <th style={thStyle}>Avg Latency</th>
            <th style={thStyle}>Avg Tokens</th>
            <th style={thStyle}>Total Cost</th>
            <th style={thStyle}>Fallbacks</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.agentId} style={{ borderBottom: "1px solid #222" }}>
              <td style={tdStyle}>
                <code style={{ color: "#a78bfa" }}>{agent.agentId}</code>
              </td>
              <td style={tdStyle}>
                <div>{agent.totalRequests.toLocaleString()}</div>
                <ProgressBar value={agent.totalRequests} max={maxRequests} color="#3b82f6" />
              </td>
              <td style={tdStyle}>
                <span style={{ 
                  color: agent.successRate >= 0.95 ? "#22c55e" : 
                         agent.successRate >= 0.8 ? "#eab308" : "#ef4444"
                }}>
                  {(agent.successRate * 100).toFixed(1)}%
                </span>
              </td>
              <td style={tdStyle}>{agent.avgLatencyMs}ms</td>
              <td style={tdStyle}>{agent.avgTokensUsed}</td>
              <td style={tdStyle}>
                <span style={{ color: "#22c55e" }}>
                  {(agent.totalCostLamports / 1e9).toFixed(6)} SOL
                </span>
              </td>
              <td style={tdStyle}>{agent.fallbackToCount}</td>
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
    <div style={{ background: "#1e1e2e", borderRadius: 12, padding: 20 }}>
      <h3 style={{ margin: "0 0 16px", color: "#fff" }}>Classification Method</h3>
      
      <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#888", fontSize: 12 }}>LLM Router</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#a78bfa" }}>{stats.llmCount}</div>
          <div style={{ fontSize: 12, color: "#666" }}>
            {(stats.llmSuccessRate * 100).toFixed(1)}% success • {stats.avgLlmLatencyMs}ms avg
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#888", fontSize: 12 }}>Keyword Fallback</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#3b82f6" }}>{stats.keywordCount}</div>
          <div style={{ fontSize: 12, color: "#666" }}>
            {(stats.keywordSuccessRate * 100).toFixed(1)}% success • {stats.avgKeywordLatencyMs}ms avg
          </div>
        </div>
      </div>
      
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ color: "#888", fontSize: 12 }}>LLM vs Keyword</span>
          <span style={{ color: "#888", fontSize: 12 }}>{llmPct.toFixed(0)}% LLM</span>
        </div>
        <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden" }}>
          <div style={{ width: `${llmPct}%`, background: "#a78bfa" }} />
          <div style={{ flex: 1, background: "#3b82f6" }} />
        </div>
      </div>
    </div>
  );
}

function TaskTypeChart({ taskTypes }: { taskTypes: TaskTypeStats[] }) {
  const maxCount = Math.max(...taskTypes.map(t => t.count), 1);
  const colors: Record<string, string> = {
    code: "#f97316",
    research: "#22c55e",
    reasoning: "#a78bfa",
    writing: "#3b82f6",
    math: "#eab308",
    translation: "#06b6d4",
    image: "#ec4899",
    unknown: "#6b7280"
  };
  
  return (
    <div style={{ background: "#1e1e2e", borderRadius: 12, padding: 20 }}>
      <h3 style={{ margin: "0 0 16px", color: "#fff" }}>Task Distribution</h3>
      {taskTypes.map((task) => (
        <div key={task.taskType} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: colors[task.taskType] || "#888", fontWeight: 500 }}>
              {task.taskType}
            </span>
            <span style={{ color: "#666", fontSize: 12 }}>
              {task.count} • {task.avgLatencyMs}ms • {(task.avgCostLamports / 1000).toFixed(0)}k lamports
            </span>
          </div>
          <ProgressBar 
            value={task.count} 
            max={maxCount} 
            color={colors[task.taskType] || "#666"} 
          />
        </div>
      ))}
    </div>
  );
}

function FailuresTable({ failures, onExplain }: { 
  failures: FailureLog[];
  onExplain: (logId: string) => void;
}) {
  return (
    <div style={{ background: "#1e1e2e", borderRadius: 12, padding: 20 }}>
      <h3 style={{ margin: "0 0 16px", color: "#fff" }}>Recent Failures</h3>
      {failures.length === 0 ? (
        <div style={{ color: "#666", textAlign: "center", padding: 20 }}>
          No failures in this period ✓
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #333" }}>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Task</th>
                <th style={thStyle}>Agent</th>
                <th style={thStyle}>Error</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr key={f.logId} style={{ borderBottom: "1px solid #222" }}>
                  <td style={tdStyle}>
                    <span style={{ color: "#888", fontSize: 12 }}>
                      {new Date(f.createdAt).toLocaleString()}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ 
                      background: "#2a2a3a", 
                      padding: "2px 8px", 
                      borderRadius: 4,
                      fontSize: 12 
                    }}>
                      {f.taskType}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <code style={{ color: "#a78bfa", fontSize: 11 }}>{f.agentId}</code>
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 300 }}>
                    <span style={{ color: "#ef4444", fontSize: 12 }}>
                      {f.errorMessage?.slice(0, 80)}
                      {f.errorMessage?.length > 80 ? "..." : ""}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => onExplain(f.logId)}
                      style={{
                        background: "#3b82f6",
                        border: "none",
                        borderRadius: 4,
                        padding: "4px 8px",
                        color: "#fff",
                        fontSize: 12,
                        cursor: "pointer"
                      }}
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

  const sectionStyle: React.CSSProperties = {
    background: "#0d0d14",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16
  };

  const labelStyle: React.CSSProperties = {
    color: "#888",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: 4
  };

  const valueStyle: React.CSSProperties = {
    color: "#fff",
    fontSize: 14
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.8)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000
    }} onClick={onClose}>
      <div style={{
        background: "#1e1e2e",
        borderRadius: 12,
        padding: 24,
        maxWidth: 700,
        width: "90%",
        maxHeight: "85vh",
        overflow: "auto"
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0, color: "#fff" }}>Routing Decision</h3>
            {data && (
              <span style={{ color: "#666", fontSize: 12 }}>
                {new Date(data.createdAt).toLocaleString()} • {data.logId.slice(0, 8)}...
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              fontSize: 20,
              cursor: "pointer"
            }}
          >
            ✕
          </button>
        </div>
        
        {loading && <div style={{ color: "#888", textAlign: "center", padding: 40 }}>Loading...</div>}
        {error && <div style={{ color: "#ef4444", padding: 20 }}>Error: {error}</div>}
        
        {data && (
          <>
            {/* Message Preview */}
            {data.messagePreview && (
              <div style={sectionStyle}>
                <div style={labelStyle}>User Message</div>
                <div style={{ ...valueStyle, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                  "{data.messagePreview}"
                  {data.messageLength > 200 && (
                    <span style={{ color: "#666" }}> ...({data.messageLength} chars total)</span>
                  )}
                </div>
              </div>
            )}
            
            {/* Classification */}
            <div style={sectionStyle}>
              <div style={labelStyle}>Task Classification</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                <span style={{
                  background: data.classificationMethod === "llm" ? "#a78bfa" : "#3b82f6",
                  color: "#fff",
                  padding: "4px 12px",
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: 600
                }}>
                  {data.taskType}
                </span>
                <span style={{ color: "#888", fontSize: 13 }}>
                  via <strong style={{ color: data.classificationMethod === "llm" ? "#a78bfa" : "#3b82f6" }}>
                    {data.classificationMethod === "llm" ? "LLM Router" : "Keyword Matching"}
                  </strong>
                </span>
                <span style={{
                  color: data.classificationConfidence >= 0.8 ? "#22c55e" : 
                         data.classificationConfidence >= 0.5 ? "#eab308" : "#ef4444",
                  fontSize: 13
                }}>
                  {Math.round(data.classificationConfidence * 100)}% confidence
                </span>
              </div>
            </div>
            
            {/* Agent Selection */}
            <div style={sectionStyle}>
              <div style={labelStyle}>Agent Selection</div>
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ color: "#22c55e", fontSize: 16 }}>✓</span>
                  <code style={{ color: "#a78bfa", fontSize: 15 }}>{data.selectedAgent.id}</code>
                  {data.selectedAgent.score !== null && (
                    <span style={{
                      background: "#2a2a3a",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      color: "#fff"
                    }}>
                      Score: {data.selectedAgent.score.toFixed(2)}
                    </span>
                  )}
                </div>
                
                {data.alternativeAgents.length > 0 && (
                  <div>
                    <div style={{ color: "#666", fontSize: 12, marginBottom: 6 }}>
                      Also considered ({data.alternativeAgents.length}):
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {data.alternativeAgents.map((agent) => (
                        <code key={agent} style={{
                          background: "#2a2a3a",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 12,
                          color: "#888"
                        }}>
                          {agent}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
                
                {data.alternativeAgents.length === 0 && (
                  <div style={{ color: "#666", fontSize: 12 }}>
                    No alternative agents available for this task type
                  </div>
                )}
              </div>
            </div>
            
            {/* Fallback Warning */}
            {data.fallbackUsed && (
              <div style={{
                ...sectionStyle,
                background: "#7f1d1d",
                border: "1px solid #ef4444"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <div>
                    <div style={{ color: "#ef4444", fontWeight: 600 }}>Fallback Used</div>
                    <div style={{ color: "#fca5a5", fontSize: 13 }}>
                      {data.failedAgentCount} agent(s) failed before this one succeeded.
                      This indicates reliability issues.
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Result */}
            <div style={{
              ...sectionStyle,
              borderLeft: `4px solid ${data.success ? "#22c55e" : "#ef4444"}`
            }}>
              <div style={labelStyle}>Result</div>
              <div style={{ marginTop: 8 }}>
                <div style={{
                  color: data.success ? "#22c55e" : "#ef4444",
                  fontSize: 16,
                  fontWeight: 600,
                  marginBottom: 8
                }}>
                  {data.success ? "✓ Success" : "✗ Failed"}
                </div>
                
                {!data.success && data.errorMessage && (
                  <div style={{
                    background: "#1a0a0a",
                    padding: 12,
                    borderRadius: 6,
                    marginBottom: 12
                  }}>
                    <code style={{ color: "#ef4444", fontSize: 13 }}>{data.errorMessage}</code>
                  </div>
                )}
                
                <div style={{ display: "flex", gap: 24 }}>
                  <div>
                    <div style={{ color: "#666", fontSize: 11 }}>Latency</div>
                    <div style={{ color: "#fff", fontSize: 14 }}>{data.latencyMs}ms</div>
                  </div>
                  <div>
                    <div style={{ color: "#666", fontSize: 11 }}>Tokens</div>
                    <div style={{ color: "#fff", fontSize: 14 }}>{data.tokensUsed.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ color: "#666", fontSize: 11 }}>Cost</div>
                    <div style={{ color: "#22c55e", fontSize: 14 }}>
                      {data.costLamports.toLocaleString()} lamports
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Summary */}
            <div style={sectionStyle}>
              <div style={labelStyle}>Analysis Summary</div>
              <div style={{
                color: "#e0e0e0",
                fontSize: 13,
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                marginTop: 8
              }}>
                {data.summary}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  color: "#888",
  fontSize: 12,
  fontWeight: 500
};

const tdStyle: React.CSSProperties = {
  padding: "12px",
  color: "#fff",
  fontSize: 14
};

// =============================================================================
// MAIN PAGE
// =============================================================================

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
      <div style={{
        minHeight: "100vh",
        background: "#0d0d14",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <form onSubmit={handleLogin} style={{
          background: "#1e1e2e",
          borderRadius: 12,
          padding: 32,
          width: 360
        }}>
          <h1 style={{ margin: "0 0 8px", color: "#fff", fontSize: 24 }}>Admin Dashboard</h1>
          <p style={{ color: "#888", margin: "0 0 24px", fontSize: 14 }}>
            Enter your admin API key to access analytics
          </p>
          
          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Admin API Key"
            style={{
              width: "100%",
              padding: "12px 16px",
              background: "#0d0d14",
              border: "1px solid #333",
              borderRadius: 8,
              color: "#fff",
              fontSize: 14,
              marginBottom: 16,
              boxSizing: "border-box"
            }}
          />
          
          <button type="submit" style={{
            width: "100%",
            padding: "12px",
            background: "#3b82f6",
            border: "none",
            borderRadius: 8,
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer"
          }}>
            Sign In
          </button>
          
          {error && (
            <div style={{ color: "#ef4444", marginTop: 16, fontSize: 14 }}>
              {error}
            </div>
          )}
        </form>
      </div>
    );
  }

  // Dashboard
  return (
    <div style={{ minHeight: "100vh", background: "#0d0d14", color: "#fff" }}>
      {/* Header */}
      <div style={{
        background: "#1e1e2e",
        padding: "16px 24px",
        borderBottom: "1px solid #333",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Monocle Admin</h1>
          <span style={{ color: "#888", fontSize: 12 }}>AI Router Analytics</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            style={{
              background: "#0d0d14",
              border: "1px solid #333",
              borderRadius: 6,
              padding: "8px 12px",
              color: "#fff",
              fontSize: 14
            }}
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={loadData}
            disabled={loading}
            style={{
              background: "#3b82f6",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              color: "#fff",
              fontSize: 14,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button
            onClick={handleLogout}
            style={{
              background: "transparent",
              border: "1px solid #333",
              borderRadius: 6,
              padding: "8px 16px",
              color: "#888",
              fontSize: 14,
              cursor: "pointer"
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
        {error && (
          <div style={{
            background: "#7f1d1d",
            border: "1px solid #ef4444",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            color: "#ef4444"
          }}>
            Error: {error}
          </div>
        )}

        {data && (
          <>
            {/* Overview Stats */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
              marginBottom: 24
            }}>
              <StatCard
                title="Total Requests"
                value={data.agents.reduce((sum, a) => sum + a.totalRequests, 0).toLocaleString()}
                subtitle={`${data.period}`}
                color="#3b82f6"
              />
              <StatCard
                title="Success Rate"
                value={`${(
                  (data.agents.reduce((sum, a) => sum + a.successCount, 0) /
                   Math.max(data.agents.reduce((sum, a) => sum + a.totalRequests, 0), 1)) * 100
                ).toFixed(1)}%`}
                color="#22c55e"
              />
              <StatCard
                title="Total Cost"
                value={`${(
                  data.agents.reduce((sum, a) => sum + a.totalCostLamports, 0) / 1e9
                ).toFixed(4)} SOL`}
                color="#a78bfa"
              />
              <StatCard
                title="LLM Classification"
                value={`${(
                  (data.classification.llmCount /
                   Math.max(data.classification.llmCount + data.classification.keywordCount, 1)) * 100
                ).toFixed(0)}%`}
                subtitle={`${data.classification.avgLlmLatencyMs}ms avg latency`}
                color="#f97316"
              />
            </div>

            {/* Charts Row */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
              marginBottom: 24
            }}>
              <ClassificationCard stats={data.classification} />
              <TaskTypeChart taskTypes={data.taskTypes} />
            </div>

            {/* Agent Table */}
            <div style={{
              background: "#1e1e2e",
              borderRadius: 12,
              padding: 20,
              marginBottom: 24
            }}>
              <h3 style={{ margin: "0 0 16px", color: "#fff" }}>Agent Performance</h3>
              <AgentTable agents={data.agents} />
            </div>

            {/* Failures */}
            <FailuresTable
              failures={data.recentFailures}
              onExplain={setExplainLogId}
            />
          </>
        )}
      </div>

      {/* Explain Modal */}
      {explainLogId && (
        <ExplainModal
          logId={explainLogId}
          onClose={() => setExplainLogId(null)}
        />
      )}
    </div>
  );
}
