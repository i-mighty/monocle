import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { getAgentBySlug, createReview, FullAgentProfile } from "../../lib/reputation-api";

export default function ReviewAgent() {
  const router = useRouter();
  const { slug } = router.query;
  const [profile, setProfile] = useState<FullAgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Review form state
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [useCase, setUseCase] = useState("");
  const [deploymentDays, setDeploymentDays] = useState("");
  const [wouldRecommend, setWouldRecommend] = useState(true);
  const [pros, setPros] = useState<string[]>([""]);
  const [cons, setCons] = useState<string[]>([""]);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerCompany, setReviewerCompany] = useState("");

  useEffect(() => {
    if (!slug || typeof slug !== "string") return;
    getAgentBySlug(slug)
      .then(setProfile)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSubmitting(true);
    setError(null);

    try {
      await createReview({
        agentId: profile.agent.id,
        reviewerId: `user-${Date.now()}`, // In production, use actual user ID
        reviewerName: reviewerName || undefined,
        reviewerCompany: reviewerCompany || undefined,
        rating,
        title: title || undefined,
        content: content || undefined,
        useCase: useCase || undefined,
        deploymentDurationDays: deploymentDays ? parseInt(deploymentDays) : undefined,
        wouldRecommend,
        pros: pros.filter(p => p.trim()),
        cons: cons.filter(c => c.trim())
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review");
    } finally {
      setSubmitting(false);
    }
  };

  const addProsCons = (type: "pros" | "cons") => {
    if (type === "pros") {
      setPros([...pros, ""]);
    } else {
      setCons([...cons, ""]);
    }
  };

  const updateProsCons = (type: "pros" | "cons", index: number, value: string) => {
    if (type === "pros") {
      const newPros = [...pros];
      newPros[index] = value;
      setPros(newPros);
    } else {
      const newCons = [...cons];
      newCons[index] = value;
      setCons(newCons);
    }
  };

  const removeProsCons = (type: "pros" | "cons", index: number) => {
    if (type === "pros") {
      setPros(pros.filter((_, i) => i !== index));
    } else {
      setCons(cons.filter((_, i) => i !== index));
    }
  };

  if (loading) {
    return (
      <main className="page">
        <style jsx global>{styles}</style>
        <div className="loading">Loading...</div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="page">
        <style jsx global>{styles}</style>
        <div className="error-state">
          <h2>Agent Not Found</h2>
          <Link href="/" className="btn-primary">Back to Marketplace</Link>
        </div>
      </main>
    );
  }

  const { agent, trustScore } = profile;

  if (submitted) {
    return (
      <main className="page">
        <style jsx global>{styles}</style>

        <header className="nav">
          <div className="brand">AgentPay Marketplace</div>
          <div className="links">
            <Link href="/">Marketplace</Link>
            <Link href="/dashboard">Dashboard</Link>
          </div>
        </header>

        <div className="success-container">
          <div className="success-icon">✓</div>
          <h1>Review Submitted!</h1>
          <p>Thank you for reviewing {agent.name}. Your feedback helps the community make better decisions.</p>
          <div className="action-buttons">
            <Link href={`/agents/${agent.slug}`} className="btn-primary">View Agent Profile</Link>
            <Link href="/" className="btn-secondary">Back to Marketplace</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <style jsx global>{styles}</style>

      <header className="nav">
        <div className="brand">AgentPay Marketplace</div>
        <div className="links">
          <Link href="/">Marketplace</Link>
          <Link href="/dashboard">Dashboard</Link>
        </div>
      </header>

      <div className="breadcrumb">
        <Link href="/">Marketplace</Link>
        <span>/</span>
        <Link href={`/agents/${agent.slug}`}>{agent.name}</Link>
        <span>/</span>
        <span>Write Review</span>
      </div>

      <div className="review-grid">
        <div className="review-form-container">
          <h1>Review {agent.name}</h1>
          <p className="subtitle">Share your experience to help others make informed decisions</p>

          {error && (
            <div className="error-banner">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="review-form">
            <section className="form-section">
              <h2>Overall Rating</h2>
              <div className="rating-selector">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`star ${star <= (hoverRating || rating) ? 'active' : ''}`}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                  >
                    ★
                  </button>
                ))}
                <span className="rating-text">
                  {rating === 5 && "Excellent"}
                  {rating === 4 && "Good"}
                  {rating === 3 && "Average"}
                  {rating === 2 && "Below Average"}
                  {rating === 1 && "Poor"}
                </span>
              </div>
            </section>

            <section className="form-section">
              <h2>Your Review</h2>
              <div className="form-group">
                <label htmlFor="title">Review Title</label>
                <input
                  id="title"
                  type="text"
                  placeholder="Summarize your experience in a few words"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="content">Detailed Review</label>
                <textarea
                  id="content"
                  rows={5}
                  placeholder="Describe your experience using this agent. What worked well? What could be improved?"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </div>
            </section>

            <section className="form-section">
              <h2>Pros & Cons</h2>
              <div className="pros-cons-grid">
                <div className="pros-section">
                  <label>Pros</label>
                  {pros.map((pro, index) => (
                    <div key={index} className="input-row">
                      <input
                        type="text"
                        placeholder="What did you like?"
                        value={pro}
                        onChange={(e) => updateProsCons("pros", index, e.target.value)}
                      />
                      {pros.length > 1 && (
                        <button type="button" className="remove-btn" onClick={() => removeProsCons("pros", index)}>×</button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="add-btn" onClick={() => addProsCons("pros")}>+ Add Pro</button>
                </div>
                <div className="cons-section">
                  <label>Cons</label>
                  {cons.map((con, index) => (
                    <div key={index} className="input-row">
                      <input
                        type="text"
                        placeholder="What could be better?"
                        value={con}
                        onChange={(e) => updateProsCons("cons", index, e.target.value)}
                      />
                      {cons.length > 1 && (
                        <button type="button" className="remove-btn" onClick={() => removeProsCons("cons", index)}>×</button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="add-btn" onClick={() => addProsCons("cons")}>+ Add Con</button>
                </div>
              </div>
            </section>

            <section className="form-section">
              <h2>Deployment Details</h2>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="useCase">Use Case</label>
                  <select id="useCase" value={useCase} onChange={(e) => setUseCase(e.target.value)}>
                    <option value="">Select use case</option>
                    <option value="automation">Automation</option>
                    <option value="data-analysis">Data Analysis</option>
                    <option value="content-generation">Content Generation</option>
                    <option value="code-assistance">Code Assistance</option>
                    <option value="research">Research</option>
                    <option value="customer-support">Customer Support</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="deploymentDays">Days Used</label>
                  <input
                    id="deploymentDays"
                    type="number"
                    min="1"
                    placeholder="How many days?"
                    value={deploymentDays}
                    onChange={(e) => setDeploymentDays(e.target.value)}
                  />
                </div>
              </div>
              <div className="recommend-section">
                <span>Would you recommend this agent?</span>
                <div className="recommend-buttons">
                  <button
                    type="button"
                    className={`recommend-btn ${wouldRecommend ? 'active yes' : ''}`}
                    onClick={() => setWouldRecommend(true)}
                  >
                    + Yes
                  </button>
                  <button
                    type="button"
                    className={`recommend-btn ${!wouldRecommend ? 'active no' : ''}`}
                    onClick={() => setWouldRecommend(false)}
                  >
                    - No
                  </button>
                </div>
              </div>
            </section>

            <section className="form-section">
              <h2>About You (Optional)</h2>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="reviewerName">Your Name</label>
                  <input
                    id="reviewerName"
                    type="text"
                    placeholder="How should we credit you?"
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="reviewerCompany">Company / Organization</label>
                  <input
                    id="reviewerCompany"
                    type="text"
                    placeholder="Where do you work?"
                    value={reviewerCompany}
                    onChange={(e) => setReviewerCompany(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <div className="form-actions">
              <Link href={`/agents/${agent.slug}`} className="btn-secondary">
                Cancel
              </Link>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Review"}
              </button>
            </div>
          </form>
        </div>

        <aside className="review-sidebar">
          <div className="agent-summary">
            <div className="agent-logo">{agent.name.charAt(0)}</div>
            <h3>{agent.name}</h3>
            <p className="version">v{agent.version}</p>
            {trustScore && (
              <div className="trust-badge">
                Trust Score: <strong>{trustScore.overallScore.toFixed(0)}</strong>
              </div>
            )}
          </div>

          <div className="guidelines">
            <h4>Review Guidelines</h4>
            <ul>
              <li>Be specific about your experience</li>
              <li>Focus on facts and observations</li>
              <li>Mention the use case and duration</li>
              <li>Be constructive with criticism</li>
              <li>Avoid personal attacks or spam</li>
            </ul>
          </div>

          <div className="community-note">
            <h4>Community Impact</h4>
            <p>Your review helps other developers and businesses make informed decisions. Quality reviews improve trust scores and help surface the best agents.</p>
          </div>
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
  .page { max-width: 1200px; margin: 0 auto; padding: 20px; }
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
  .error-banner {
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #fca5a5;
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 24px;
  }
  .review-grid {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 24px;
  }
  @media (max-width: 900px) {
    .review-grid { grid-template-columns: 1fr; }
  }
  .review-form-container {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 20px;
    padding: 32px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .review-form-container h1 {
    font-size: 28px;
    font-weight: 700;
    color: #f1f5f9;
    margin-bottom: 8px;
  }
  .subtitle {
    color: #94a3b8;
    margin-bottom: 32px;
  }
  .form-section {
    margin-bottom: 32px;
  }
  .form-section h2 {
    font-size: 16px;
    color: #c4b5fd;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(139, 92, 246, 0.2);
  }
  .rating-selector {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .star {
    font-size: 40px;
    background: none;
    border: none;
    color: #4b5563;
    cursor: pointer;
    transition: color 0.2s, transform 0.2s;
    padding: 0;
  }
  .star:hover { transform: scale(1.1); }
  .star.active { color: #fbbf24; }
  .rating-text {
    margin-left: 16px;
    color: #94a3b8;
    font-size: 16px;
  }
  .form-group {
    margin-bottom: 16px;
  }
  .form-group label {
    display: block;
    font-size: 14px;
    color: #e2e8f0;
    margin-bottom: 8px;
    font-weight: 500;
  }
  .form-group input[type="text"],
  .form-group input[type="number"],
  .form-group textarea,
  .form-group select {
    width: 100%;
    padding: 12px 16px;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 16px;
    transition: border-color 0.2s;
    font-family: inherit;
  }
  .form-group input:focus,
  .form-group textarea:focus,
  .form-group select:focus {
    outline: none;
    border-color: #8b5cf6;
  }
  .form-group input::placeholder,
  .form-group textarea::placeholder { color: #64748b; }
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .pros-cons-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  .pros-section label, .cons-section label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 12px;
  }
  .pros-section label { color: #22c55e; }
  .cons-section label { color: #ef4444; }
  .input-row {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }
  .input-row input {
    flex: 1;
    padding: 10px 14px;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 14px;
  }
  .input-row input:focus {
    outline: none;
    border-color: #8b5cf6;
  }
  .remove-btn {
    width: 36px;
    height: 36px;
    background: rgba(239, 68, 68, 0.2);
    border: none;
    border-radius: 8px;
    color: #ef4444;
    font-size: 20px;
    cursor: pointer;
  }
  .remove-btn:hover { background: rgba(239, 68, 68, 0.3); }
  .add-btn {
    background: transparent;
    border: 1px dashed rgba(139, 92, 246, 0.4);
    color: #a5b4fc;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    margin-top: 8px;
  }
  .add-btn:hover {
    border-color: #8b5cf6;
    background: rgba(139, 92, 246, 0.1);
  }
  .recommend-section {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid rgba(139, 92, 246, 0.1);
  }
  .recommend-section span {
    color: #e2e8f0;
    font-weight: 500;
  }
  .recommend-buttons {
    display: flex;
    gap: 12px;
  }
  .recommend-btn {
    padding: 10px 20px;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 8px;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 14px;
  }
  .recommend-btn.active.yes {
    background: rgba(34, 197, 94, 0.2);
    border-color: #22c55e;
    color: #22c55e;
  }
  .recommend-btn.active.no {
    background: rgba(239, 68, 68, 0.2);
    border-color: #ef4444;
    color: #ef4444;
  }
  .form-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid rgba(139, 92, 246, 0.2);
  }
  .btn-primary, .btn-secondary {
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
  .btn-primary:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(139, 92, 246, 0.4);
  }
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: rgba(139, 92, 246, 0.2);
    color: #c4b5fd;
  }
  .btn-secondary:hover { background: rgba(139, 92, 246, 0.3); }
  .review-sidebar {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .agent-summary, .guidelines, .community-note {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 16px;
    padding: 20px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .agent-summary {
    text-align: center;
  }
  .agent-logo {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: linear-gradient(135deg, #4f46e5, #7c3aed);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 700;
    color: white;
    margin: 0 auto 12px;
  }
  .agent-summary h3 {
    font-size: 18px;
    color: #f1f5f9;
    margin-bottom: 4px;
  }
  .version {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 12px;
  }
  .trust-badge {
    display: inline-block;
    padding: 6px 12px;
    background: rgba(34, 197, 94, 0.2);
    border-radius: 6px;
    font-size: 13px;
    color: #22c55e;
  }
  .trust-badge strong { color: #4ade80; }
  .guidelines h4, .community-note h4 {
    font-size: 14px;
    color: #c4b5fd;
    margin-bottom: 12px;
  }
  .guidelines ul {
    list-style: none;
  }
  .guidelines li {
    padding: 6px 0;
    font-size: 13px;
    color: #94a3b8;
    padding-left: 20px;
    position: relative;
  }
  .guidelines li::before {
    content: "•";
    position: absolute;
    left: 0;
    color: #8b5cf6;
  }
  .community-note p {
    font-size: 13px;
    color: #94a3b8;
    line-height: 1.6;
  }
  .success-container {
    max-width: 500px;
    margin: 60px auto;
    text-align: center;
    padding: 40px;
  }
  .success-icon {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: linear-gradient(135deg, #22c55e, #16a34a);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 40px;
    color: white;
    margin: 0 auto 24px;
  }
  .success-container h1 {
    font-size: 28px;
    color: #f1f5f9;
    margin-bottom: 12px;
  }
  .success-container p {
    color: #94a3b8;
    margin-bottom: 32px;
  }
  .action-buttons {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
`;
