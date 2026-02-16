import Link from "next/link";
import { useEffect, useState } from "react";
import { getUsage, getEarnings, getToolLogs, getDeployedAgents, DeployedAgent } from "../lib/api";
import { searchAgents, AgentSearchResult } from "../lib/reputation-api";

type UsageRow = { agent_id: string; calls: number; spend: number };
type LogRow = { agent_id: string; tool_name: string; tokens_used: number; timestamp: string };

// Deployed agent display type
interface DisplayAgent {
  id: string;
  name: string;
  slug: string;
  status: "active" | "inactive";
  spend: number;
  calls: number;
}

export default function Dashboard() {
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [totalEarned, setTotalEarned] = useState(0);
  const [recentLogs, setRecentLogs] = useState<LogRow[]>([]);
  const [marketplaceAgents, setMarketplaceAgents] = useState<AgentSearchResult[]>([]);
  const [deployedAgents, setDeployedAgents] = useState<DisplayAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setAuthError(null);
      
      // Get API key from localStorage (set in login page)
      const apiKey = typeof window !== "undefined" ? localStorage.getItem("apiKey") : null;
      
      try {
        const [usageData, earningsData, logsData, agentsData] = await Promise.allSettled([
          getUsage(),
          getEarnings(),
          getToolLogs(),
          searchAgents({ limit: 3, minTrust: 70 })
        ]);
        
        if (usageData.status === 'fulfilled') setUsage(usageData.value);
        if (earningsData.status === 'fulfilled') setTotalEarned(Number(earningsData.value?.total_sol || 0));
        if (logsData.status === 'fulfilled') setRecentLogs(logsData.value?.slice(0, 5) || []);
        if (agentsData.status === 'fulfilled') setMarketplaceAgents(agentsData.value?.agents || []);
        
        // Fetch deployed agents if API key is available
        if (apiKey) {
          try {
            const agents = await getDeployedAgents(apiKey);
            const data = agents.data || agents;
            setDeployedAgents((data || []).map((agent: DeployedAgent) => ({
              id: agent.agentId,
              name: agent.name || agent.agentId,
              slug: agent.agentId.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              status: "active" as const,
              spend: agent.balanceLamports / 1e9, // Convert lamports to SOL
              calls: 0, // Will be populated from metrics
            })));
          } catch (err) {
            console.warn("Failed to load deployed agents - authentication may be required");
            setAuthError("API key required to view deployed agents");
          }
        } else {
          setAuthError("Please log in to view your deployed agents");
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      }
      setLoading(false);
    };
    loadData();
  }, []);

  const totalSpend = deployedAgents.reduce((acc, a) => acc + a.spend, 0);
  const totalCalls = deployedAgents.reduce((acc, a) => acc + a.calls, 0);

  return (
    <main className="page">
      <style jsx global>{styles}</style>

      <header className="nav">
        <div className="brand">AgentPay Marketplace</div>
        <div className="links">
          <Link href="/">Marketplace</Link>
          <Link href="/economy">Economy</Link>
          <Link href="/dashboard" className="active">Dashboard</Link>
          <Link href="/usage">Usage</Link>
          <Link href="/receipts">Receipts</Link>
        </div>
      </header>

      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <p>Manage your deployed agents and monitor usage</p>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon">AG</div>
          <div className="stat-content">
            <div className="stat-value">{deployedAgents.length}</div>
            <div className="stat-label">Deployed Agents</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">#</div>
          <div className="stat-content">
            <div className="stat-value">{totalCalls.toLocaleString()}</div>
            <div className="stat-label">Total Calls</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">-</div>
          <div className="stat-content">
            <div className="stat-value">{totalSpend.toFixed(4)} SOL</div>
            <div className="stat-label">Total Spend</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">+</div>
          <div className="stat-content">
            <div className="stat-value">{totalEarned.toFixed(4)} SOL</div>
            <div className="stat-label">Total Earned</div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="card deployed-agents">
          <div className="card-header">
            <h2>Deployed Agents</h2>
            <Link href="/" className="btn-small">+ Deploy New</Link>
          </div>
          <div className="agents-list">
            {authError && (
              <div className="auth-warning">
                <p>{authError}</p>
                <Link href="/login" className="btn-primary">Log In</Link>
              </div>
            )}
            {!authError && deployedAgents.map((agent) => (
              <div key={agent.id} className="deployed-agent">
                <div className="agent-avatar">{agent.name.charAt(0)}</div>
                <div className="agent-info">
                  <div className="agent-name">{agent.name}</div>
                  <div className="agent-stats">
                    <span>{agent.calls} calls</span>
                    <span>{agent.spend.toFixed(4)} SOL spent</span>
                  </div>
                </div>
                <div className="agent-status">
                  <span className={`status-badge ${agent.status}`}>{agent.status}</span>
                </div>
                <div className="agent-actions">
                  <Link href={`/agents/${agent.slug}`} className="action-btn">View</Link>
                  <Link href={`/review/${agent.slug}`} className="action-btn">Review</Link>
                </div>
              </div>
            ))}
            {!authError && deployedAgents.length === 0 && (
              <div className="empty-state">
                <p>No agents deployed yet</p>
                <Link href="/" className="btn-primary">Browse Marketplace</Link>
              </div>
            )}
          </div>
        </section>

        <section className="card recent-activity">
          <div className="card-header">
            <h2>Recent Activity</h2>
            <Link href="/usage" className="view-all">View All</Link>
          </div>
          <div className="activity-list">
            {recentLogs.length > 0 ? (
              recentLogs.map((log, idx) => (
                <div key={idx} className="activity-item">
                  <div className="activity-icon">*</div>
                  <div className="activity-details">
                    <div className="activity-title">{log.tool_name}</div>
                    <div className="activity-meta">
                      {log.agent_id} • {log.tokens_used} tokens
                    </div>
                  </div>
                  <div className="activity-time">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state small">
                <p>No recent activity</p>
              </div>
            )}
          </div>
        </section>

        <section className="card recommended">
          <div className="card-header">
            <h2>Recommended Agents</h2>
            <Link href="/" className="view-all">View All</Link>
          </div>
          <div className="recommended-list">
            {marketplaceAgents.filter(item => item.agent).map(({ agent, trustScore }) => (
              <Link key={agent.id} href={`/agents/${agent.slug}`} className="recommended-agent">
                <div className="rec-avatar">{agent.name.charAt(0)}</div>
                <div className="rec-info">
                  <div className="rec-name">{agent.name}</div>
                  <div className="rec-trust">Trust: {trustScore?.overallScore.toFixed(0) || 'N/A'}</div>
                </div>
                <div className="rec-arrow">→</div>
              </Link>
            ))}
            {marketplaceAgents.filter(item => item.agent).length === 0 && !loading && (
              <div className="empty-state small">
                <p>Start the reputation API to see recommendations</p>
              </div>
            )}
          </div>
        </section>

        <section className="card quick-actions">
          <div className="card-header">
            <h2>Quick Actions</h2>
          </div>
          <div className="actions-grid">
            <Link href="/" className="quick-action">
              <span className="qa-icon">Search</span>
              <span className="qa-label">Browse Agents</span>
            </Link>
            <Link href="/usage" className="quick-action">
              <span className="qa-icon">Stats</span>
              <span className="qa-label">View Usage</span>
            </Link>
            <Link href="/receipts" className="quick-action">
              <span className="qa-icon">Pay</span>
              <span className="qa-label">Receipts</span>
            </Link>
            <a href="https://docs.agentpay.dev" target="_blank" rel="noopener" className="quick-action">
              <span className="qa-icon">Docs</span>
              <span className="qa-label">Documentation</span>
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}

const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
    min-height: 100vh;
    color: #e2e8f0;
  }
  .page { max-width: 1400px; margin: 0 auto; padding: 20px; }
  .nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
    background: rgba(30, 27, 75, 0.8);
    border-radius: 16px;
    margin-bottom: 24px;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .brand {
    font-size: 24px;
    font-weight: 700;
    background: linear-gradient(135deg, #8b5cf6, #06b6d4);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .links { display: flex; gap: 8px; }
  .links a {
    color: #a5b4fc;
    text-decoration: none;
    padding: 8px 16px;
    border-radius: 8px;
    transition: all 0.2s;
  }
  .links a:hover, .links a.active {
    background: rgba(139, 92, 246, 0.2);
    color: #c4b5fd;
  }
  .dashboard-header {
    margin-bottom: 24px;
  }
  .dashboard-header h1 {
    font-size: 32px;
    font-weight: 700;
    color: #f1f5f9;
    margin-bottom: 8px;
  }
  .dashboard-header p {
    color: #94a3b8;
  }
  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 24px;
  }
  @media (max-width: 900px) {
    .stats-row { grid-template-columns: repeat(2, 1fr); }
  }
  .stat-card {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 16px;
    padding: 20px;
    border: 1px solid rgba(139, 92, 246, 0.2);
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .stat-icon {
    font-size: 16px;
    font-weight: 700;
    color: #c4b5fd;
    background: rgba(139, 92, 246, 0.2);
    width: 56px;
    height: 56px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .stat-value {
    font-size: 24px;
    font-weight: 700;
    color: #f1f5f9;
  }
  .stat-label {
    font-size: 13px;
    color: #64748b;
  }
  .dashboard-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  @media (max-width: 900px) {
    .dashboard-grid { grid-template-columns: 1fr; }
  }
  .card {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 16px;
    padding: 20px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(139, 92, 246, 0.1);
  }
  .card-header h2 {
    font-size: 16px;
    font-weight: 600;
    color: #f1f5f9;
  }
  .btn-small {
    padding: 6px 12px;
    background: linear-gradient(135deg, #8b5cf6, #6366f1);
    border-radius: 6px;
    color: white;
    font-size: 12px;
    text-decoration: none;
    font-weight: 500;
  }
  .view-all {
    font-size: 13px;
    color: #a5b4fc;
    text-decoration: none;
  }
  .view-all:hover { text-decoration: underline; }
  .deployed-agents { grid-column: span 2; }
  @media (max-width: 900px) {
    .deployed-agents { grid-column: span 1; }
  }
  .agents-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .deployed-agent {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 12px;
  }
  .agent-avatar {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: linear-gradient(135deg, #4f46e5, #7c3aed);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
    color: white;
  }
  .agent-info { flex: 1; }
  .agent-name {
    font-weight: 600;
    color: #f1f5f9;
    margin-bottom: 4px;
  }
  .agent-stats {
    font-size: 12px;
    color: #64748b;
    display: flex;
    gap: 12px;
  }
  .status-badge {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 6px;
    text-transform: uppercase;
    font-weight: 600;
  }
  .status-badge.active {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
  }
  .agent-actions {
    display: flex;
    gap: 8px;
  }
  .action-btn {
    padding: 6px 12px;
    background: rgba(139, 92, 246, 0.2);
    border-radius: 6px;
    color: #c4b5fd;
    font-size: 12px;
    text-decoration: none;
  }
  .action-btn:hover {
    background: rgba(139, 92, 246, 0.3);
  }
  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .activity-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 10px;
  }
  .activity-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: rgba(59, 130, 246, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    color: #60a5fa;
  }
  .activity-details { flex: 1; }
  .activity-title {
    font-size: 14px;
    font-weight: 500;
    color: #e2e8f0;
  }
  .activity-meta {
    font-size: 12px;
    color: #64748b;
  }
  .activity-time {
    font-size: 11px;
    color: #64748b;
  }
  .recommended-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .recommended-agent {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 10px;
    text-decoration: none;
    transition: background 0.2s;
  }
  .recommended-agent:hover {
    background: rgba(15, 23, 42, 0.8);
  }
  .rec-avatar {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: linear-gradient(135deg, #4f46e5, #7c3aed);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    color: white;
  }
  .rec-info { flex: 1; }
  .rec-name {
    font-size: 14px;
    font-weight: 500;
    color: #e2e8f0;
  }
  .rec-trust {
    font-size: 12px;
    color: #22c55e;
  }
  .rec-arrow {
    color: #64748b;
    font-size: 18px;
  }
  .actions-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  .quick-action {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 12px;
    text-decoration: none;
    transition: background 0.2s, transform 0.2s;
  }
  .quick-action:hover {
    background: rgba(15, 23, 42, 0.8);
    transform: translateY(-2px);
  }
  .qa-icon {
    font-size: 12px;
    font-weight: 600;
    color: #c4b5fd;
    text-transform: uppercase;
  }
  .qa-label {
    font-size: 12px;
    color: #94a3b8;
  }
  .empty-state {
    text-align: center;
    padding: 32px;
    color: #64748b;
  }
  .empty-state.small {
    padding: 20px;
  }
  .empty-state p {
    margin-bottom: 12px;
  }
  .btn-primary {
    display: inline-block;
    padding: 10px 20px;
    background: linear-gradient(135deg, #8b5cf6, #6366f1);
    border-radius: 8px;
    color: white;
    text-decoration: none;
    font-weight: 500;
    font-size: 14px;
  }
`;
