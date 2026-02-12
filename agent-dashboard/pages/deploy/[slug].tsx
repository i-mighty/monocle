import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { getAgentBySlug, FullAgentProfile } from "../../lib/reputation-api";

export default function DeployAgent() {
  const router = useRouter();
  const { slug } = router.query;
  const [profile, setProfile] = useState<FullAgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);
  
  // Deploy configuration
  const [walletAddress, setWalletAddress] = useState("");
  const [spendingLimit, setSpendingLimit] = useState("0.1");
  const [dailyLimit, setDailyLimit] = useState("1.0");
  const [notifyOnSpend, setNotifyOnSpend] = useState(true);
  const [autoRefill, setAutoRefill] = useState(false);
  const [apiKeyName, setApiKeyName] = useState("");

  useEffect(() => {
    if (!slug || typeof slug !== "string") return;
    getAgentBySlug(slug)
      .then(setProfile)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [slug]);

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    
    setDeploying(true);
    
    // Simulate deployment - in production this would:
    // 1. Register with agent-backend (create API key)
    // 2. Set up payment authorization
    // 3. Initialize metering
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setDeployed(true);
    setDeploying(false);
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

  if (deployed) {
    return (
      <main className="page">
        <style jsx global>{styles}</style>
        
        <header className="nav">
          <div className="brand">AgentPay Marketplace</div>
          <div className="links">
            <Link href="/">Marketplace</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/usage">Usage</Link>
          </div>
        </header>

        <div className="success-container">
          <div className="success-icon">✓</div>
          <h1>Agent Deployed Successfully!</h1>
          <p>{agent.name} is now ready to use with your configured payment limits.</p>
          
          <div className="credentials-box">
            <h3>Your API Key</h3>
            <code className="api-key">ap_live_{Math.random().toString(36).substring(2, 15)}_{Math.random().toString(36).substring(2, 15)}</code>
            <p className="warning">Important: Save this key now - you won't be able to see it again!</p>
          </div>

          <div className="config-summary">
            <h3>Configuration Summary</h3>
            <div className="summary-grid">
              <div className="summary-item">
                <span>Spending Limit per Request</span>
                <strong>{spendingLimit} SOL</strong>
              </div>
              <div className="summary-item">
                <span>Daily Limit</span>
                <strong>{dailyLimit} SOL</strong>
              </div>
              <div className="summary-item">
                <span>Wallet</span>
                <strong>{walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}</strong>
              </div>
            </div>
          </div>

          <div className="next-steps">
            <h3>Next Steps</h3>
            <ol>
              <li>Add the API key to your environment variables</li>
              <li>Install the AgentPay SDK: <code>npm install @agentpay/sdk</code></li>
              <li>Initialize the client with your key</li>
              <li>Start making agent calls!</li>
            </ol>
            <pre className="code-block">{`import { AgentPayClient } from '@agentpay/sdk';

const client = new AgentPayClient({
  apiKey: process.env.AGENTPAY_API_KEY,
  agentId: '${agent.id}'
});

// Make a paid tool call
const result = await client.callTool('search', { query: 'example' });`}</pre>
          </div>

          <div className="action-buttons">
            <Link href="/dashboard" className="btn-primary">Go to Dashboard</Link>
            <Link href={`/agents/${agent.slug}`} className="btn-secondary">View Agent Profile</Link>
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
          <Link href="/usage">Usage</Link>
        </div>
      </header>

      <div className="breadcrumb">
        <Link href="/">Marketplace</Link>
        <span>/</span>
        <Link href={`/agents/${agent.slug}`}>{agent.name}</Link>
        <span>/</span>
        <span>Deploy</span>
      </div>

      <div className="deploy-grid">
        <div className="deploy-form-container">
          <h1>Deploy {agent.name}</h1>
          <p className="subtitle">Configure payment settings and get your API key</p>

          <form onSubmit={handleDeploy} className="deploy-form">
            <section className="form-section">
              <h2>Wallet Configuration</h2>
              <div className="form-group">
                <label htmlFor="wallet">Solana Wallet Address</label>
                <input
                  id="wallet"
                  type="text"
                  placeholder="Enter your Solana wallet address"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  required
                />
                <span className="hint">This wallet will be charged for agent usage</span>
              </div>
            </section>

            <section className="form-section">
              <h2>Spending Limits</h2>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="spendLimit">Per-Request Limit (SOL)</label>
                  <input
                    id="spendLimit"
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={spendingLimit}
                    onChange={(e) => setSpendingLimit(e.target.value)}
                    required
                  />
                  <span className="hint">Maximum SOL per single request</span>
                </div>
                <div className="form-group">
                  <label htmlFor="dailyLimit">Daily Limit (SOL)</label>
                  <input
                    id="dailyLimit"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    required
                  />
                  <span className="hint">Maximum spend in 24 hours</span>
                </div>
              </div>
            </section>

            <section className="form-section">
              <h2>Notifications & Automation</h2>
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={notifyOnSpend}
                    onChange={(e) => setNotifyOnSpend(e.target.checked)}
                  />
                  <span className="checkmark"></span>
                  Notify me on each payment
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={autoRefill}
                    onChange={(e) => setAutoRefill(e.target.checked)}
                  />
                  <span className="checkmark"></span>
                  Auto-refill from wallet when balance is low
                </label>
              </div>
            </section>

            <section className="form-section">
              <h2>API Key</h2>
              <div className="form-group">
                <label htmlFor="keyName">Key Name (optional)</label>
                <input
                  id="keyName"
                  type="text"
                  placeholder="e.g., Production Key, Dev Key"
                  value={apiKeyName}
                  onChange={(e) => setApiKeyName(e.target.value)}
                />
                <span className="hint">A friendly name to identify this key</span>
              </div>
            </section>

            <div className="form-actions">
              <Link href={`/agents/${agent.slug}`} className="btn-secondary">
                Cancel
              </Link>
              <button type="submit" className="btn-primary" disabled={deploying || !walletAddress}>
                {deploying ? "Deploying..." : "Deploy Agent"}
              </button>
            </div>
          </form>
        </div>

        <aside className="deploy-sidebar">
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

          <div className="pricing-info">
            <h4>Typical Costs</h4>
            <div className="price-item">
              <span>Average per request</span>
              <strong>~0.0001 SOL</strong>
            </div>
            <div className="price-item">
              <span>Complex operations</span>
              <strong>~0.001 SOL</strong>
            </div>
            <p className="price-note">
              Actual costs depend on the complexity of each request and current network fees.
            </p>
          </div>

          <div className="security-info">
            <h4>Security</h4>
            <ul>
              <li>✓ End-to-end encrypted communication</li>
              <li>✓ Rate limiting protection</li>
              <li>✓ Spending limits enforced on-chain</li>
              <li>✓ Revoke access anytime from dashboard</li>
            </ul>
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
  .deploy-grid {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 24px;
  }
  @media (max-width: 900px) {
    .deploy-grid { grid-template-columns: 1fr; }
  }
  .deploy-form-container {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 20px;
    padding: 32px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .deploy-form-container h1 {
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
  .form-group input[type="number"] {
    width: 100%;
    padding: 12px 16px;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 16px;
    transition: border-color 0.2s;
  }
  .form-group input:focus {
    outline: none;
    border-color: #8b5cf6;
  }
  .form-group input::placeholder { color: #64748b; }
  .hint {
    display: block;
    font-size: 12px;
    color: #64748b;
    margin-top: 6px;
  }
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    color: #e2e8f0;
  }
  .checkbox-label input {
    width: 18px;
    height: 18px;
    accent-color: #8b5cf6;
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
  .deploy-sidebar {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .agent-summary, .pricing-info, .security-info {
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
  .pricing-info h4, .security-info h4 {
    font-size: 14px;
    color: #c4b5fd;
    margin-bottom: 12px;
  }
  .price-item {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid rgba(139, 92, 246, 0.1);
    font-size: 14px;
  }
  .price-item span { color: #94a3b8; }
  .price-item strong { color: #e2e8f0; }
  .price-note {
    font-size: 12px;
    color: #64748b;
    margin-top: 12px;
    line-height: 1.5;
  }
  .security-info ul {
    list-style: none;
  }
  .security-info li {
    padding: 6px 0;
    font-size: 13px;
    color: #94a3b8;
  }
  .success-container {
    max-width: 700px;
    margin: 0 auto;
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
    font-size: 32px;
    color: #f1f5f9;
    margin-bottom: 12px;
  }
  .success-container > p {
    color: #94a3b8;
    margin-bottom: 32px;
  }
  .credentials-box {
    background: rgba(30, 27, 75, 0.8);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 24px;
    border: 1px solid rgba(139, 92, 246, 0.3);
  }
  .credentials-box h3 {
    font-size: 14px;
    color: #c4b5fd;
    margin-bottom: 12px;
  }
  .api-key {
    display: block;
    padding: 12px 16px;
    background: rgba(15, 23, 42, 0.8);
    border-radius: 8px;
    font-family: monospace;
    font-size: 14px;
    color: #22c55e;
    word-break: break-all;
    margin-bottom: 12px;
  }
  .warning {
    font-size: 12px;
    color: #f59e0b;
  }
  .config-summary {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
    text-align: left;
  }
  .config-summary h3 {
    font-size: 14px;
    color: #c4b5fd;
    margin-bottom: 12px;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .summary-item {
    padding: 12px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 8px;
  }
  .summary-item span {
    display: block;
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .summary-item strong {
    color: #e2e8f0;
    font-size: 14px;
  }
  .next-steps {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 24px;
    text-align: left;
  }
  .next-steps h3 {
    font-size: 14px;
    color: #c4b5fd;
    margin-bottom: 16px;
  }
  .next-steps ol {
    margin-left: 20px;
    margin-bottom: 20px;
  }
  .next-steps li {
    color: #94a3b8;
    padding: 6px 0;
  }
  .next-steps code {
    background: rgba(139, 92, 246, 0.2);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
    color: #c4b5fd;
  }
  .code-block {
    background: rgba(15, 23, 42, 0.8);
    padding: 16px;
    border-radius: 8px;
    font-family: monospace;
    font-size: 13px;
    color: #94a3b8;
    overflow-x: auto;
    text-align: left;
    white-space: pre;
  }
  .action-buttons {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-top: 32px;
  }
`;
