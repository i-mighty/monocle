import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { getAgentBySlug, FullAgentProfile } from "../../lib/reputation-api";

export default function AgentProfile() {
  const router = useRouter();
  const { slug } = router.query;
  const [profile, setProfile] = useState<FullAgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "reviews" | "skills">("overview");

  useEffect(() => {
    if (!slug || typeof slug !== "string") return;
    
    setLoading(true);
    getAgentBySlug(slug)
      .then(setProfile)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  const getTrustColor = (score: number) => {
    if (score >= 80) return "#22c55e";
    if (score >= 60) return "#eab308";
    if (score >= 40) return "#f97316";
    return "#ef4444";
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  };

  if (loading) {
    return (
      <main className="page">
        <style jsx global>{styles}</style>
        <div className="loading">Loading agent profile...</div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="page">
        <style jsx global>{styles}</style>
        <div className="error-state">
          <h2>Agent Not Found</h2>
          <p>{error || "The agent you're looking for doesn't exist"}</p>
          <Link href="/" className="btn-primary">Back to Marketplace</Link>
        </div>
      </main>
    );
  }

  const { agent, builder, skills, badges, reviews, trustScore } = profile;
  const score = trustScore?.overallScore || 0;

  return (
    <main className="page">
      <style jsx global>{styles}</style>

      <header className="nav">
        <div className="brand">AgentPay Marketplace</div>
        <div className="links">
          <Link href="/">Marketplace</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/usage">Usage</Link>
          <Link href="/receipts">Receipts</Link>
        </div>
      </header>

      <div className="breadcrumb">
        <Link href="/">Marketplace</Link>
        <span>/</span>
        <span>{agent.name}</span>
      </div>

      <div className="profile-grid">
        <div className="profile-main">
          <section className="profile-header">
            <div className="agent-logo-large">
              {agent.name.charAt(0)}
            </div>
            <div className="agent-details">
              <h1>
                {agent.name}
                {agent.isVerified && (
                  <span className="verified-badge">✓ Verified</span>
                )}
              </h1>
              <p className="builder-info">
                by <strong>{builder?.name || 'Unknown Builder'}</strong> • Version {agent.version}
              </p>
              <p className="description">{agent.description}</p>
              <div className="action-buttons">
                <Link href={`/deploy/${agent.slug}`} className="btn-primary">
                  Deploy Agent
                </Link>
                <Link href={`/review/${agent.slug}`} className="btn-secondary">
                  Write Review
                </Link>
                {agent.sourceUrl && (
                  <a href={agent.sourceUrl} target="_blank" rel="noopener" className="btn-outline">
                    View Source
                  </a>
                )}
              </div>
            </div>
          </section>

          <div className="tabs">
            <button
              className={activeTab === "overview" ? "active" : ""}
              onClick={() => setActiveTab("overview")}
            >
              Overview
            </button>
            <button
              className={activeTab === "reviews" ? "active" : ""}
              onClick={() => setActiveTab("reviews")}
            >
              Reviews ({reviews.length})
            </button>
            <button
              className={activeTab === "skills" ? "active" : ""}
              onClick={() => setActiveTab("skills")}
            >
              Skills & Benchmarks
            </button>
          </div>

          {activeTab === "overview" && (
            <section className="tab-content">
              <div className="metrics-grid">
                {trustScore?.reliabilityScore !== undefined && (
                  <div className="metric-card">
                    <div className="metric-value">{trustScore.reliabilityScore.toFixed(0)}%</div>
                    <div className="metric-label">Reliability</div>
                    <div className="metric-bar">
                      <div style={{ width: `${trustScore.reliabilityScore}%`, background: "#22c55e" }} />
                    </div>
                  </div>
                )}
                {trustScore?.performanceScore !== undefined && (
                  <div className="metric-card">
                    <div className="metric-value">{trustScore.performanceScore.toFixed(0)}%</div>
                    <div className="metric-label">Performance</div>
                    <div className="metric-bar">
                      <div style={{ width: `${trustScore.performanceScore}%`, background: "#3b82f6" }} />
                    </div>
                  </div>
                )}
                {trustScore?.securityScore !== undefined && (
                  <div className="metric-card">
                    <div className="metric-value">{trustScore.securityScore.toFixed(0)}%</div>
                    <div className="metric-label">Security</div>
                    <div className="metric-bar">
                      <div style={{ width: `${trustScore.securityScore}%`, background: "#f59e0b" }} />
                    </div>
                  </div>
                )}
                {trustScore?.satisfactionScore !== undefined && (
                  <div className="metric-card">
                    <div className="metric-value">{trustScore.satisfactionScore.toFixed(0)}%</div>
                    <div className="metric-label">Satisfaction</div>
                    <div className="metric-bar">
                      <div style={{ width: `${trustScore.satisfactionScore}%`, background: "#8b5cf6" }} />
                    </div>
                  </div>
                )}
              </div>

              {badges.length > 0 && (
                <div className="badges-section">
                  <h3>Badges & Achievements</h3>
                  <div className="badges-grid">
                    {badges.map((badge) => (
                      <div key={badge.id} className="badge-item">
                        <div className="badge-icon">*</div>
                        <div className="badge-info">
                          <div className="badge-name">{badge.name}</div>
                          <div className="badge-desc">{badge.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="info-section">
                <h3>Technical Details</h3>
                <div className="info-grid">
                  {agent.mcpEndpoint && (
                    <div className="info-item">
                      <span className="info-label">MCP Endpoint</span>
                      <code>{agent.mcpEndpoint}</code>
                    </div>
                  )}
                  {agent.a2aCardUrl && (
                    <div className="info-item">
                      <span className="info-label">A2A Card</span>
                      <a href={agent.a2aCardUrl} target="_blank" rel="noopener">{agent.a2aCardUrl}</a>
                    </div>
                  )}
                  <div className="info-item">
                    <span className="info-label">Created</span>
                    <span>{formatDate(agent.createdAt)}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Last Updated</span>
                    <span>{formatDate(agent.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === "reviews" && (
            <section className="tab-content">
              {reviews.length === 0 ? (
                <div className="empty-reviews">
                  <p>No reviews yet. Be the first to review this agent!</p>
                  <Link href={`/review/${agent.slug}`} className="btn-primary">Write Review</Link>
                </div>
              ) : (
                <div className="reviews-list">
                  {reviews.map((review) => (
                    <div key={review.id} className="review-card">
                      <div className="review-header">
                        <div className="reviewer">
                          <div className="reviewer-avatar">{review.reviewerName?.charAt(0) || 'A'}</div>
                          <div className="reviewer-info">
                            <div className="reviewer-name">{review.reviewerName || 'Anonymous'}</div>
                            <div className="reviewer-company">{review.reviewerCompany}</div>
                          </div>
                        </div>
                        <div className="review-rating">
                          {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
                        </div>
                      </div>
                      {review.title && <h4 className="review-title">{review.title}</h4>}
                      <p className="review-content">{review.content}</p>
                      {(review.pros?.length || review.cons?.length) && (
                        <div className="pros-cons">
                          {review.pros && review.pros.length > 0 && (
                            <div className="pros">
                              <strong>Pros:</strong>
                              <ul>{review.pros.map((p, i) => <li key={i}>{p}</li>)}</ul>
                            </div>
                          )}
                          {review.cons && review.cons.length > 0 && (
                            <div className="cons">
                              <strong>Cons:</strong>
                              <ul>{review.cons.map((c, i) => <li key={i}>{c}</li>)}</ul>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="review-footer">
                        <span>{formatDate(review.createdAt)}</span>
                        {review.verifiedDeployment && (
                          <span className="verified-deployment">✓ Verified Deployment</span>
                        )}
                        {review.wouldRecommend && (
                          <span className="would-recommend">+ Would Recommend</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === "skills" && (
            <section className="tab-content">
              {skills.length === 0 ? (
                <div className="empty-skills">
                  <p>No verified skills or benchmarks yet.</p>
                </div>
              ) : (
                <div className="skills-list">
                  {skills.map((skill) => (
                    <div key={skill.id} className="skill-card">
                      <div className="skill-header">
                        <span className="skill-name">{skill.skillName}</span>
                        {skill.verified && <span className="skill-verified">✓ Verified</span>}
                      </div>
                      {skill.benchmarkName && (
                        <div className="benchmark">
                          <span className="benchmark-name">{skill.benchmarkName}</span>
                          {skill.benchmarkScore !== undefined && (
                            <span className="benchmark-score">{skill.benchmarkScore.toFixed(1)}</span>
                          )}
                          {skill.benchmarkPercentile !== undefined && (
                            <span className="benchmark-percentile">Top {100 - skill.benchmarkPercentile}%</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="profile-sidebar">
          <div className="trust-card">
            <div className="trust-header">Trust Score</div>
            <div className="trust-score-large" style={{ color: getTrustColor(score) }}>
              {score.toFixed(0)}
            </div>
            <div className="trust-bar-large">
              <div style={{ width: `${score}%`, background: getTrustColor(score) }} />
            </div>
            {trustScore?.decayFactor !== undefined && trustScore.decayFactor < 1 && (
              <div className="decay-warning">
                Warning: Score adjusted by {((1 - trustScore.decayFactor) * 100).toFixed(1)}% due to inactivity
              </div>
            )}
            <div className="trust-updated">
              Last calculated: {trustScore ? formatDate(trustScore.lastCalculated) : 'N/A'}
            </div>
          </div>

          <div className="quick-stats">
            <div className="quick-stat">
              <span className="qs-value">{reviews.length}</span>
              <span className="qs-label">Reviews</span>
            </div>
            <div className="quick-stat">
              <span className="qs-value">{skills.length}</span>
              <span className="qs-label">Skills</span>
            </div>
            <div className="quick-stat">
              <span className="qs-value">{badges.length}</span>
              <span className="qs-label">Badges</span>
            </div>
          </div>

          {builder && (
            <div className="builder-card">
              <h4>Built by</h4>
              <div className="builder-details">
                <div className="builder-logo">{builder.name.charAt(0)}</div>
                <div>
                  <div className="builder-name">
                    {builder.name}
                    {builder.verified && <span className="builder-verified">✓</span>}
                  </div>
                  {builder.website && (
                    <a href={builder.website} target="_blank" rel="noopener" className="builder-website">
                      {builder.website}
                    </a>
                  )}
                </div>
              </div>
              {builder.description && <p className="builder-desc">{builder.description}</p>}
            </div>
          )}
        </aside>
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
  .links a:hover { background: rgba(139, 92, 246, 0.2); color: #c4b5fd; }
  .breadcrumb {
    display: flex;
    gap: 8px;
    color: #64748b;
    margin-bottom: 24px;
    font-size: 14px;
  }
  .breadcrumb a { color: #a5b4fc; text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; }
  .loading, .error-state {
    text-align: center;
    padding: 80px 24px;
    color: #94a3b8;
  }
  .error-state h2 { margin-bottom: 12px; color: #f1f5f9; }
  .error-state .btn-primary { margin-top: 24px; display: inline-block; }
  .profile-grid {
    display: grid;
    grid-template-columns: 1fr 340px;
    gap: 24px;
  }
  @media (max-width: 900px) {
    .profile-grid { grid-template-columns: 1fr; }
  }
  .profile-main { min-width: 0; }
  .profile-header {
    display: flex;
    gap: 24px;
    padding: 32px;
    background: rgba(30, 27, 75, 0.6);
    border-radius: 20px;
    border: 1px solid rgba(139, 92, 246, 0.2);
    margin-bottom: 24px;
  }
  .agent-logo-large {
    width: 120px;
    height: 120px;
    border-radius: 20px;
    background: linear-gradient(135deg, #4f46e5, #7c3aed);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 48px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }
  .agent-details { flex: 1; }
  .agent-details h1 {
    font-size: 32px;
    font-weight: 700;
    color: #f1f5f9;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .verified-badge {
    font-size: 12px;
    padding: 4px 12px;
    background: #8b5cf6;
    border-radius: 6px;
    font-weight: 600;
  }
  .builder-info {
    color: #94a3b8;
    margin-bottom: 12px;
  }
  .description {
    color: #cbd5e1;
    line-height: 1.6;
    margin-bottom: 20px;
  }
  .action-buttons {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .btn-primary, .btn-secondary, .btn-outline {
    padding: 12px 24px;
    border-radius: 8px;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s;
    cursor: pointer;
    border: none;
    font-size: 14px;
  }
  .btn-primary {
    background: linear-gradient(135deg, #8b5cf6, #6366f1);
    color: white;
  }
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(139, 92, 246, 0.4);
  }
  .btn-secondary {
    background: rgba(139, 92, 246, 0.2);
    color: #c4b5fd;
  }
  .btn-secondary:hover {
    background: rgba(139, 92, 246, 0.3);
  }
  .btn-outline {
    background: transparent;
    border: 1px solid rgba(139, 92, 246, 0.4);
    color: #a5b4fc;
  }
  .btn-outline:hover {
    border-color: #8b5cf6;
    background: rgba(139, 92, 246, 0.1);
  }
  .tabs {
    display: flex;
    gap: 4px;
    background: rgba(30, 27, 75, 0.4);
    padding: 4px;
    border-radius: 12px;
    margin-bottom: 24px;
  }
  .tabs button {
    flex: 1;
    padding: 12px 20px;
    background: transparent;
    border: none;
    color: #94a3b8;
    font-weight: 500;
    cursor: pointer;
    border-radius: 8px;
    transition: all 0.2s;
  }
  .tabs button.active {
    background: rgba(139, 92, 246, 0.3);
    color: #c4b5fd;
  }
  .tabs button:hover:not(.active) {
    background: rgba(139, 92, 246, 0.1);
  }
  .tab-content {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 16px;
    padding: 24px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 16px;
    margin-bottom: 32px;
  }
  .metric-card {
    background: rgba(15, 23, 42, 0.6);
    padding: 16px;
    border-radius: 12px;
    text-align: center;
  }
  .metric-value {
    font-size: 28px;
    font-weight: 700;
    color: #f1f5f9;
  }
  .metric-label {
    font-size: 12px;
    color: #64748b;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .metric-bar {
    height: 4px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
    overflow: hidden;
  }
  .metric-bar > div {
    height: 100%;
    border-radius: 2px;
  }
  .badges-section { margin-bottom: 32px; }
  .badges-section h3 {
    font-size: 16px;
    color: #f1f5f9;
    margin-bottom: 16px;
  }
  .badges-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }
  .badge-item {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 10px;
  }
  .badge-icon {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 700;
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.2);
    border-radius: 8px;
  }
  .badge-name { font-weight: 600; color: #f1f5f9; }
  .badge-desc { font-size: 12px; color: #64748b; }
  .info-section h3 {
    font-size: 16px;
    color: #f1f5f9;
    margin-bottom: 16px;
  }
  .info-grid {
    display: grid;
    gap: 12px;
  }
  .info-item {
    display: flex;
    justify-content: space-between;
    padding: 12px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 8px;
  }
  .info-label { color: #64748b; }
  .info-item code {
    font-family: monospace;
    color: #a5b4fc;
    font-size: 13px;
  }
  .info-item a { color: #a5b4fc; text-decoration: none; }
  .info-item a:hover { text-decoration: underline; }
  .empty-reviews, .empty-skills {
    text-align: center;
    padding: 40px;
    color: #64748b;
  }
  .empty-reviews .btn-primary { margin-top: 16px; display: inline-block; }
  .reviews-list { display: grid; gap: 16px; }
  .review-card {
    padding: 20px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 12px;
  }
  .review-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }
  .reviewer {
    display: flex;
    gap: 12px;
  }
  .reviewer-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    color: white;
  }
  .reviewer-name { font-weight: 600; color: #f1f5f9; }
  .reviewer-company { font-size: 12px; color: #64748b; }
  .review-rating { color: #fbbf24; font-size: 18px; }
  .review-title {
    font-size: 16px;
    color: #f1f5f9;
    margin-bottom: 8px;
  }
  .review-content {
    color: #cbd5e1;
    line-height: 1.6;
    margin-bottom: 12px;
  }
  .pros-cons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 12px;
  }
  .pros, .cons {
    font-size: 14px;
  }
  .pros strong { color: #22c55e; }
  .cons strong { color: #ef4444; }
  .pros ul, .cons ul {
    margin-top: 8px;
    padding-left: 20px;
    color: #94a3b8;
  }
  .review-footer {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: #64748b;
  }
  .verified-deployment { color: #22c55e; }
  .would-recommend { color: #8b5cf6; }
  .skills-list { display: grid; gap: 12px; }
  .skill-card {
    padding: 16px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 10px;
  }
  .skill-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .skill-name { font-weight: 600; color: #f1f5f9; }
  .skill-verified { color: #22c55e; font-size: 12px; }
  .benchmark {
    display: flex;
    gap: 16px;
    font-size: 14px;
    color: #94a3b8;
  }
  .benchmark-score { color: #c4b5fd; font-weight: 600; }
  .benchmark-percentile { color: #22c55e; }
  .profile-sidebar {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .trust-card {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 16px;
    padding: 24px;
    border: 1px solid rgba(139, 92, 246, 0.2);
    text-align: center;
  }
  .trust-header {
    font-size: 14px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 12px;
  }
  .trust-score-large {
    font-size: 64px;
    font-weight: 800;
    line-height: 1;
    margin-bottom: 16px;
  }
  .trust-bar-large {
    height: 10px;
    background: rgba(15, 23, 42, 0.8);
    border-radius: 5px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .trust-bar-large > div {
    height: 100%;
    border-radius: 5px;
    transition: width 0.5s;
  }
  .decay-warning {
    font-size: 12px;
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.1);
    padding: 8px;
    border-radius: 6px;
    margin-bottom: 12px;
  }
  .trust-updated {
    font-size: 12px;
    color: #64748b;
  }
  .quick-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .quick-stat {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 12px;
    padding: 16px;
    text-align: center;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .qs-value {
    display: block;
    font-size: 24px;
    font-weight: 700;
    color: #c4b5fd;
  }
  .qs-label {
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
  }
  .builder-card {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 16px;
    padding: 20px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .builder-card h4 {
    font-size: 12px;
    color: #64748b;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .builder-details {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
  }
  .builder-logo {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 20px;
    color: white;
  }
  .builder-name {
    font-weight: 600;
    color: #f1f5f9;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .builder-verified { color: #22c55e; font-size: 12px; }
  .builder-website {
    font-size: 12px;
    color: #a5b4fc;
    text-decoration: none;
  }
  .builder-website:hover { text-decoration: underline; }
  .builder-desc {
    font-size: 13px;
    color: #94a3b8;
    line-height: 1.5;
  }
`;
