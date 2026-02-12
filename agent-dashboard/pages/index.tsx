import Link from "next/link";
import { useEffect, useState } from "react";
import { searchAgents, AgentSearchResult } from "../lib/reputation-api";

export default function Marketplace() {
  const [agents, setAgents] = useState<AgentSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [minTrust, setMinTrust] = useState<number | undefined>();
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const result = await searchAgents({
        query: searchQuery || undefined,
        minTrust,
        verified: verifiedOnly || undefined
      });
      setAgents(result.agents);
    } catch (err) {
      console.error("Failed to load agents:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadAgents();
  };

  const getTrustColor = (score: number) => {
    if (score >= 80) return "#22c55e";
    if (score >= 60) return "#eab308";
    if (score >= 40) return "#f97316";
    return "#ef4444";
  };

  const getVerificationBadge = (tier: string) => {
    const badges: Record<string, { color: string; label: string }> = {
      enterprise: { color: "#8b5cf6", label: "Enterprise" },
      standard: { color: "#3b82f6", label: "Standard" },
      basic: { color: "#6b7280", label: "Basic" },
      none: { color: "transparent", label: "" }
    };
    return badges[tier] || badges.none;
  };

  return (
    <main className="page">
      <style jsx global>{`
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
        .hero {
          text-align: center;
          padding: 48px 24px;
          background: rgba(30, 27, 75, 0.6);
          border-radius: 24px;
          margin-bottom: 32px;
          border: 1px solid rgba(139, 92, 246, 0.2);
        }
        .hero h1 {
          font-size: 48px;
          font-weight: 800;
          margin-bottom: 16px;
          background: linear-gradient(135deg, #c4b5fd, #06b6d4);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .hero p {
          font-size: 18px;
          color: #94a3b8;
          max-width: 600px;
          margin: 0 auto;
        }
        .search-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          padding: 20px;
          background: rgba(30, 27, 75, 0.6);
          border-radius: 16px;
          margin-bottom: 24px;
          border: 1px solid rgba(139, 92, 246, 0.2);
        }
        .search-bar input[type="text"] {
          flex: 1;
          min-width: 200px;
          padding: 12px 16px;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 8px;
          color: #e2e8f0;
          font-size: 16px;
        }
        .search-bar input[type="text"]:focus {
          outline: none;
          border-color: #8b5cf6;
        }
        .search-bar input[type="text"]::placeholder { color: #64748b; }
        .search-bar select {
          padding: 12px 16px;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 8px;
          color: #e2e8f0;
          cursor: pointer;
        }
        .search-bar label {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #94a3b8;
        }
        .search-bar button {
          padding: 12px 24px;
          background: linear-gradient(135deg, #8b5cf6, #6366f1);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .search-bar button:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(139, 92, 246, 0.4);
        }
        .agents-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 20px;
        }
        .agent-card {
          background: rgba(30, 27, 75, 0.6);
          border-radius: 16px;
          padding: 24px;
          border: 1px solid rgba(139, 92, 246, 0.2);
          transition: transform 0.2s, box-shadow 0.2s;
          cursor: pointer;
          text-decoration: none;
          color: inherit;
          display: block;
        }
        .agent-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 40px rgba(139, 92, 246, 0.3);
          border-color: rgba(139, 92, 246, 0.5);
        }
        .agent-header {
          display: flex;
          gap: 16px;
          margin-bottom: 16px;
        }
        .agent-logo {
          width: 64px;
          height: 64px;
          border-radius: 12px;
          background: linear-gradient(135deg, #4f46e5, #7c3aed);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          font-weight: 700;
          color: white;
        }
        .agent-info { flex: 1; }
        .agent-name {
          font-size: 20px;
          font-weight: 700;
          color: #f1f5f9;
          margin-bottom: 4px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .verification-badge {
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 600;
          text-transform: uppercase;
        }
        .agent-builder {
          font-size: 14px;
          color: #94a3b8;
        }
        .trust-score {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .trust-value {
          font-size: 32px;
          font-weight: 800;
        }
        .trust-label {
          font-size: 12px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .trust-bar {
          flex: 1;
          height: 8px;
          background: rgba(15, 23, 42, 0.8);
          border-radius: 4px;
          overflow: hidden;
        }
        .trust-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.5s ease;
        }
        .agent-description {
          font-size: 14px;
          color: #94a3b8;
          line-height: 1.5;
          margin-bottom: 12px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .agent-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .tag {
          font-size: 12px;
          padding: 4px 10px;
          background: rgba(139, 92, 246, 0.2);
          color: #c4b5fd;
          border-radius: 6px;
        }
        .loading {
          text-align: center;
          padding: 48px;
          color: #94a3b8;
        }
        .empty-state {
          text-align: center;
          padding: 48px;
          color: #64748b;
        }
        .stats-bar {
          display: flex;
          justify-content: center;
          gap: 48px;
          margin-top: 24px;
        }
        .stat-item {
          text-align: center;
        }
        .stat-value {
          font-size: 32px;
          font-weight: 700;
          color: #c4b5fd;
        }
        .stat-label {
          font-size: 14px;
          color: #64748b;
        }
      `}</style>

      <header className="nav">
        <div className="brand">AgentPay Marketplace</div>
        <div className="links">
          <Link href="/" className="active">Marketplace</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/usage">Usage</Link>
          <Link href="/receipts">Receipts</Link>
        </div>
      </header>

      <section className="hero">
        <h1>Discover Trusted AI Agents</h1>
        <p>Find, verify, and deploy AI agents with transparent reputation scores and verified performance metrics</p>
        <div className="stats-bar">
          <div className="stat-item">
            <div className="stat-value">{agents.length}</div>
            <div className="stat-label">Active Agents</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{agents.filter(a => a.agent?.isVerified).length}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{agents.filter(a => (a.trustScore?.overallScore || 0) >= 80).length}</div>
            <div className="stat-label">High Trust</div>
          </div>
        </div>
      </section>

      <form className="search-bar" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search agents by name, skill, or use case..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select
          value={minTrust || ""}
          onChange={(e) => setMinTrust(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">Any Trust Score</option>
          <option value="80">80+ Trust</option>
          <option value="60">60+ Trust</option>
          <option value="40">40+ Trust</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
          />
          Verified Only
        </label>
        <button type="submit">Search</button>
      </form>

      {loading ? (
        <div className="loading">Loading agents...</div>
      ) : agents.length === 0 ? (
        <div className="empty-state">No agents found matching your criteria</div>
      ) : (
        <div className="agents-grid">
          {agents.filter(item => item.agent).map(({ agent, trustScore, builder }) => {
            const badge = getVerificationBadge(agent.verificationTier);
            const score = trustScore?.overallScore || 0;
            return (
              <Link href={`/agents/${agent.slug}`} key={agent.id} className="agent-card">
                <div className="agent-header">
                  <div className="agent-logo">
                    {agent.name.charAt(0)}
                  </div>
                  <div className="agent-info">
                    <div className="agent-name">
                      {agent.name}
                      {agent.isVerified && (
                        <span 
                          className="verification-badge"
                          style={{ background: badge.color }}
                        >
                          ✓ {badge.label}
                        </span>
                      )}
                    </div>
                    <div className="agent-builder">
                      by {builder?.name || 'Unknown Builder'} • v{agent.version}
                    </div>
                  </div>
                </div>
                
                <div className="trust-score">
                  <span className="trust-value" style={{ color: getTrustColor(score) }}>
                    {score.toFixed(0)}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="trust-label">Trust Score</div>
                    <div className="trust-bar">
                      <div 
                        className="trust-fill" 
                        style={{ 
                          width: `${score}%`,
                          background: getTrustColor(score)
                        }} 
                      />
                    </div>
                  </div>
                </div>

                {agent.description && (
                  <p className="agent-description">{agent.description}</p>
                )}

                <div className="agent-tags">
                  <span className="tag">{agent.status}</span>
                  {agent.mcpEndpoint && <span className="tag">MCP</span>}
                  {agent.a2aCardUrl && <span className="tag">A2A</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
