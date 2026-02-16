import Link from "next/link";
import { useEffect, useState } from "react";
import {
  registerAgent,
  getDeployedAgents,
  getAgentEconomicState,
  executeToolCall,
  getToolCallHistory,
  getEarningsHistory,
  getPricingConstants,
  previewCost,
  getSettlementHistory,
  settlePayment,
  getPlatformRevenue,
  topUpAgent,
  getStoredApiKey,
  getDepositAddress,
  createDepositIntent,
  verifyDeposit,
  getDepositHistory,
  getPendingDepositIntents,
  withdrawToWallet,
  RegisterAgentRequest,
  AgentEconomicState,
  ExecuteCallRequest,
  ExecuteCallResult,
  ToolCallRecord,
  PricingConstants,
  CostPreview,
  Settlement,
  PlatformRevenue,
  DeployedAgent,
  DepositAddress,
  DepositIntent,
  Deposit,
  PendingIntent,
} from "../lib/api";

// =============================================================================
// TYPES
// =============================================================================

interface AgentOption {
  id: string;
  name: string;
  rate: number;
  balance: number;
  pending: number;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function EconomyControlPanel() {
  // Auth state
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Agent list
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [economicState, setEconomicState] = useState<AgentEconomicState | null>(null);

  // Register form
  const [registerForm, setRegisterForm] = useState<RegisterAgentRequest>({
    agentId: "",
    name: "",
    publicKey: "",
    ratePer1kTokens: 1000,
  });

  // Execute call form
  const [callForm, setCallForm] = useState<ExecuteCallRequest>({
    callerId: "",
    calleeId: "",
    toolName: "default-tool",
    tokensUsed: 1000,
  });
  const [costPreview, setCostPreview] = useState<CostPreview | null>(null);
  const [callResult, setCallResult] = useState<ExecuteCallResult | null>(null);

  // History
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [earnings, setEarnings] = useState<ToolCallRecord[]>([]);

  // Pricing
  const [pricingConstants, setPricingConstants] = useState<PricingConstants | null>(null);

  // Settlements
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [platformRevenue, setPlatformRevenue] = useState<PlatformRevenue | null>(null);

  // Deposits
  const [depositAddress, setDepositAddress] = useState<DepositAddress | null>(null);
  const [depositIntent, setDepositIntent] = useState<DepositIntent | null>(null);
  const [depositHistory, setDepositHistory] = useState<Deposit[]>([]);
  const [pendingIntents, setPendingIntents] = useState<PendingIntent[]>([]);
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [verifyTxSignature, setVerifyTxSignature] = useState<string>("");
  const [withdrawForm, setWithdrawForm] = useState({ amount: "", toAddress: "" });

  // UI state
  const [activeTab, setActiveTab] = useState<"register" | "state" | "execute" | "pricing" | "settlements" | "deposits">("register");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // =============================================================================
  // EFFECTS
  // =============================================================================

  useEffect(() => {
    const key = getStoredApiKey();
    if (key) {
      setApiKey(key);
      setIsAuthenticated(true);
      loadAgents(key);
    }
    loadPricingConstants();
  }, []);

  useEffect(() => {
    if (selectedAgent && isAuthenticated) {
      loadEconomicState(selectedAgent);
      loadHistory(selectedAgent);
      loadSettlements(selectedAgent);
      loadDeposits(selectedAgent);
    }
  }, [selectedAgent, isAuthenticated]);

  // Load deposit address on mount
  useEffect(() => {
    loadDepositAddress();
  }, []);

  // Auto-preview cost when call form changes
  useEffect(() => {
    if (callForm.callerId && callForm.calleeId && callForm.tokensUsed > 0 && isAuthenticated) {
      previewCallCost();
    }
  }, [callForm.callerId, callForm.calleeId, callForm.tokensUsed]);

  // =============================================================================
  // DATA LOADERS
  // =============================================================================

  const loadAgents = async (key?: string) => {
    try {
      const data = await getDeployedAgents(key || apiKey!, 100);
      const agentList = (data.data || data || []).map((a: DeployedAgent) => ({
        id: a.agentId,
        name: a.name || a.agentId,
        rate: a.ratePer1kTokens,
        balance: a.balanceLamports,
        pending: a.pendingLamports,
      }));
      setAgents(agentList);
      if (agentList.length > 0 && !selectedAgent) {
        setSelectedAgent(agentList[0].id);
      }
    } catch (err) {
      console.error("Failed to load agents:", err);
    }
  };

  const loadEconomicState = async (agentId: string) => {
    try {
      const state = await getAgentEconomicState(agentId);
      setEconomicState(state);
    } catch (err) {
      console.error("Failed to load economic state:", err);
    }
  };

  const loadHistory = async (agentId: string) => {
    try {
      const [calls, earningsData] = await Promise.all([
        getToolCallHistory(agentId, 20),
        getEarningsHistory(agentId, 20),
      ]);
      setToolCalls(calls || []);
      setEarnings(earningsData || []);
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  };

  const loadPricingConstants = async () => {
    try {
      const constants = await getPricingConstants();
      setPricingConstants(constants);
    } catch (err) {
      console.error("Failed to load pricing constants:", err);
    }
  };

  const loadSettlements = async (agentId: string) => {
    try {
      const [settleData, revenueData] = await Promise.all([
        getSettlementHistory(agentId).catch(() => []),
        getPlatformRevenue().catch(() => null),
      ]);
      setSettlements(settleData || []);
      setPlatformRevenue(revenueData);
    } catch (err) {
      console.error("Failed to load settlements:", err);
    }
  };

  const loadDepositAddress = async () => {
    try {
      const addr = await getDepositAddress();
      setDepositAddress(addr);
    } catch (err) {
      console.error("Failed to load deposit address:", err);
    }
  };

  const loadDeposits = async (agentId: string) => {
    try {
      const [historyData, pendingData] = await Promise.all([
        getDepositHistory(agentId).catch(() => ({ deposits: [] })),
        getPendingDepositIntents(agentId).catch(() => ({ pendingIntents: [] })),
      ]);
      setDepositHistory(historyData.deposits || []);
      setPendingIntents(pendingData.pendingIntents || []);
    } catch (err) {
      console.error("Failed to load deposits:", err);
    }
  };

  // =============================================================================
  // ACTIONS
  // =============================================================================

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const input = (document.getElementById("apiKeyInput") as HTMLInputElement)?.value;
    if (input) {
      localStorage.setItem("apiKey", input);
      setApiKey(input);
      setIsAuthenticated(true);
      loadAgents(input);
      showMessage("success", "Logged in successfully");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerForm.agentId) {
      showMessage("error", "Agent ID is required");
      return;
    }

    setLoading(true);
    try {
      const result = await registerAgent(registerForm);
      showMessage("success", `Agent "${result.agentId}" registered successfully!`);
      setRegisterForm({ agentId: "", name: "", publicKey: "", ratePer1kTokens: 1000 });
      await loadAgents();
      setSelectedAgent(result.agentId);
    } catch (err: any) {
      showMessage("error", err.message || "Registration failed");
    }
    setLoading(false);
  };

  const previewCallCost = async () => {
    try {
      const preview = await previewCost({
        callerId: callForm.callerId,
        calleeId: callForm.calleeId,
        toolName: callForm.toolName,
        tokensEstimate: callForm.tokensUsed,
      });
      setCostPreview(preview);
    } catch (err) {
      setCostPreview(null);
    }
  };

  const handleExecuteCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callForm.callerId || !callForm.calleeId) {
      showMessage("error", "Select both caller and callee agents");
      return;
    }

    setLoading(true);
    try {
      const result = await executeToolCall(callForm);
      setCallResult(result);
      showMessage("success", `Call executed! Cost: ${result.costLamports} lamports`);
      // Refresh data
      await loadAgents();
      await loadEconomicState(selectedAgent);
      await loadHistory(selectedAgent);
    } catch (err: any) {
      showMessage("error", err.message || "Call execution failed");
    }
    setLoading(false);
  };

  const handleSettle = async (agentId: string) => {
    setLoading(true);
    try {
      const result = await settlePayment(agentId);
      showMessage("success", `Settlement initiated! TX: ${result.txSignature?.slice(0, 16)}...`);
      await loadSettlements(agentId);
      await loadEconomicState(agentId);
    } catch (err: any) {
      showMessage("error", err.message || "Settlement failed");
    }
    setLoading(false);
  };

  const handleTopUp = async (agentId: string, amount: number) => {
    setLoading(true);
    try {
      await topUpAgent(agentId, amount);
      showMessage("success", `Added ${amount} lamports to ${agentId}`);
      await loadAgents();
      await loadEconomicState(agentId);
    } catch (err: any) {
      showMessage("error", err.message || "Top-up failed (demo endpoints may be disabled)");
    }
    setLoading(false);
  };

  const handleCreateDepositIntent = async () => {
    if (!selectedAgent) {
      showMessage("error", "Select an agent first");
      return;
    }
    setLoading(true);
    try {
      const amount = depositAmount ? parseInt(depositAmount) : undefined;
      const intent = await createDepositIntent(selectedAgent, amount);
      setDepositIntent(intent);
      showMessage("success", "Deposit intent created! Send SOL to the address shown.");
      await loadDeposits(selectedAgent);
    } catch (err: any) {
      showMessage("error", err.message || "Failed to create deposit intent");
    }
    setLoading(false);
  };

  const handleVerifyDeposit = async () => {
    if (!selectedAgent || !verifyTxSignature) {
      showMessage("error", "Enter a transaction signature to verify");
      return;
    }
    setLoading(true);
    try {
      const result = await verifyDeposit(verifyTxSignature, selectedAgent);
      if (result.verified) {
        showMessage("success", `Deposit verified! ${result.amountLamports} lamports credited.`);
        setVerifyTxSignature("");
        await loadDeposits(selectedAgent);
        await loadEconomicState(selectedAgent);
        await loadAgents();
      } else {
        showMessage("error", result.message || "Deposit not verified");
      }
    } catch (err: any) {
      showMessage("error", err.message || "Verification failed");
    }
    setLoading(false);
  };

  const handleWithdraw = async () => {
    if (!selectedAgent || !withdrawForm.amount || !withdrawForm.toAddress) {
      showMessage("error", "Enter amount and destination address");
      return;
    }
    setLoading(true);
    try {
      const result = await withdrawToWallet(
        selectedAgent,
        parseInt(withdrawForm.amount),
        withdrawForm.toAddress
      );
      showMessage("success", `Withdrawal sent! TX: ${result.txSignature.slice(0, 16)}...`);
      setWithdrawForm({ amount: "", toAddress: "" });
      await loadDeposits(selectedAgent);
      await loadEconomicState(selectedAgent);
      await loadAgents();
    } catch (err: any) {
      showMessage("error", err.message || "Withdrawal failed");
    }
    setLoading(false);
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // =============================================================================
  // HELPERS
  // =============================================================================

  const formatLamports = (lamports: number) => {
    const sol = lamports / 1e9;
    if (sol >= 0.001) return `${sol.toFixed(6)} SOL`;
    return `${lamports.toLocaleString()} lamports`;
  };

  const formatTime = (ts: string) => {
    return new Date(ts).toLocaleString();
  };

  // =============================================================================
  // RENDER
  // =============================================================================

  if (!isAuthenticated) {
    return (
      <main className="page">
        <style jsx global>{styles}</style>
        <nav className="nav">
          <div className="brand">AgentPay</div>
          <div className="links">
            <Link href="/">Marketplace</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/economy" className="active">Economy</Link>
          </div>
        </nav>
        <div className="auth-panel">
          <h1>Agent Economy Control Panel</h1>
          <p>Enter your API key to access the control panel</p>
          <form onSubmit={handleLogin} className="auth-form">
            <input
              id="apiKeyInput"
              type="password"
              placeholder="Enter API Key"
              className="input-lg"
            />
            <button type="submit" className="btn-primary">Login</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <style jsx global>{styles}</style>
      
      {/* Navigation */}
      <nav className="nav">
        <div className="brand">AgentPay</div>
        <div className="links">
          <Link href="/">Marketplace</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/economy" className="active">Economy</Link>
        </div>
      </nav>

      {/* Message Toast */}
      {message && (
        <div className={`toast toast-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Header */}
      <header className="hero">
        <h1>Agent Economy Control Panel</h1>
        <p>Register agents, execute calls, view economics, and manage settlements</p>
      </header>

      {/* Tab Navigation */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === "register" ? "active" : ""}`}
          onClick={() => setActiveTab("register")}
        >
          1. Register Agent
        </button>
        <button
          className={`tab ${activeTab === "state" ? "active" : ""}`}
          onClick={() => setActiveTab("state")}
        >
          2. Economic State
        </button>
        <button
          className={`tab ${activeTab === "execute" ? "active" : ""}`}
          onClick={() => setActiveTab("execute")}
        >
          3. Execute Call
        </button>
        <button
          className={`tab ${activeTab === "pricing" ? "active" : ""}`}
          onClick={() => setActiveTab("pricing")}
        >
          4. Pricing
        </button>
        <button
          className={`tab ${activeTab === "settlements" ? "active" : ""}`}
          onClick={() => setActiveTab("settlements")}
        >
          5. Settlements
        </button>
        <button
          className={`tab ${activeTab === "deposits" ? "active" : ""}`}
          onClick={() => setActiveTab("deposits")}
        >
          6. Deposits
        </button>
      </div>

      {/* Content Panels */}
      <div className="panel-container">
        {/* 1. REGISTER AGENT */}
        {activeTab === "register" && (
          <section className="panel">
            <h2>Register New Agent</h2>
            <p className="description">Create an agent that can participate in the token economy</p>
            
            <form onSubmit={handleRegister} className="form">
              <div className="form-group">
                <label>Agent ID *</label>
                <input
                  type="text"
                  placeholder="my-agent-001"
                  value={registerForm.agentId}
                  onChange={(e) => setRegisterForm({ ...registerForm, agentId: e.target.value })}
                  required
                />
                <span className="hint">Unique identifier for your agent</span>
              </div>

              <div className="form-group">
                <label>Display Name</label>
                <input
                  type="text"
                  placeholder="My Awesome Agent"
                  value={registerForm.name || ""}
                  onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Wallet Address</label>
                <input
                  type="text"
                  placeholder="Solana public key for settlements"
                  value={registerForm.publicKey || ""}
                  onChange={(e) => setRegisterForm({ ...registerForm, publicKey: e.target.value })}
                />
                <span className="hint">Your Solana wallet address for receiving payments</span>
              </div>

              <div className="form-group">
                <label>Rate per 1K Tokens (lamports)</label>
                <input
                  type="number"
                  min="1"
                  value={registerForm.ratePer1kTokens || 1000}
                  onChange={(e) => setRegisterForm({ ...registerForm, ratePer1kTokens: parseInt(e.target.value) || 1000 })}
                />
                <span className="hint">
                  {registerForm.ratePer1kTokens || 1000} lamports = {((registerForm.ratePer1kTokens || 1000) / 1e9).toFixed(9)} SOL per 1K tokens
                </span>
              </div>

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Registering..." : "Register Agent"}
              </button>
            </form>

            {/* Existing Agents */}
            <div className="agents-list">
              <h3>Registered Agents ({agents.length})</h3>
              {agents.map((agent) => (
                <div key={agent.id} className="agent-card" onClick={() => setSelectedAgent(agent.id)}>
                  <div className="agent-name">{agent.name}</div>
                  <div className="agent-id">{agent.id}</div>
                  <div className="agent-stats">
                    <span>Rate: {agent.rate} lamports/1K</span>
                    <span>Balance: {formatLamports(agent.balance)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 2. ECONOMIC STATE */}
        {activeTab === "state" && (
          <section className="panel">
            <h2>Economic State</h2>
            
            <div className="form-group">
              <label>Select Agent</label>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                ))}
              </select>
            </div>

            {economicState && (
              <>
                <div className="stats-grid">
                  <div className="stat-card primary">
                    <div className="stat-value">{formatLamports(economicState.balanceLamports)}</div>
                    <div className="stat-label">Current Balance</div>
                  </div>
                  <div className="stat-card success">
                    <div className="stat-value">{formatLamports(economicState.pendingLamports)}</div>
                    <div className="stat-label">Pending Earnings</div>
                  </div>
                  <div className="stat-card danger">
                    <div className="stat-value">{formatLamports(economicState.totalSpentLamports || 0)}</div>
                    <div className="stat-label">Total Spend</div>
                  </div>
                  <div className="stat-card info">
                    <div className="stat-value">{formatLamports(economicState.totalEarnedLamports || 0)}</div>
                    <div className="stat-label">Total Revenue</div>
                  </div>
                </div>

                <div className="metrics-row">
                  <div className="metric">
                    <span className="metric-label">Calls Made:</span>
                    <span className="metric-value">{economicState.totalCallsMade || 0}</span>
                  </div>
                  <div className="metric">
                    <span className="metric-label">Calls Received:</span>
                    <span className="metric-value">{economicState.totalCallsReceived || 0}</span>
                  </div>
                  <div className="metric">
                    <span className="metric-label">Rate:</span>
                    <span className="metric-value">{economicState.ratePer1kTokens} lamports/1K</span>
                  </div>
                </div>

                {/* Recent Tool Calls */}
                <div className="history-section">
                  <h3>Recent Tool Calls (Outgoing)</h3>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Callee</th>
                        <th>Tool</th>
                        <th>Tokens</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {toolCalls.length === 0 && (
                        <tr><td colSpan={5} className="empty">No tool calls yet</td></tr>
                      )}
                      {toolCalls.slice(0, 10).map((call, i) => (
                        <tr key={i}>
                          <td>{formatTime(call.timestamp)}</td>
                          <td>{call.calleeId}</td>
                          <td>{call.toolName}</td>
                          <td>{call.tokensUsed}</td>
                          <td className="cost">{formatLamports(call.costLamports)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Earnings */}
                <div className="history-section">
                  <h3>Recent Earnings (Incoming)</h3>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Caller</th>
                        <th>Tool</th>
                        <th>Tokens</th>
                        <th>Earned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {earnings.length === 0 && (
                        <tr><td colSpan={5} className="empty">No earnings yet</td></tr>
                      )}
                      {earnings.slice(0, 10).map((call, i) => (
                        <tr key={i}>
                          <td>{formatTime(call.timestamp)}</td>
                          <td>{call.callerId}</td>
                          <td>{call.toolName}</td>
                          <td>{call.tokensUsed}</td>
                          <td className="earned">{formatLamports(call.costLamports)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {/* 3. EXECUTE CALL - THE KILLER FEATURE */}
        {activeTab === "execute" && (
          <section className="panel">
            <h2>Execute Tool Call</h2>
            <p className="description">
              <strong>The Killer Feature:</strong> Execute a real economic transaction between agents
            </p>

            <div className="execute-grid">
              {/* Call Form */}
              <div className="execute-form">
                <form onSubmit={handleExecuteCall}>
                  <div className="form-group">
                    <label>Caller Agent (pays)</label>
                    <select
                      value={callForm.callerId}
                      onChange={(e) => setCallForm({ ...callForm, callerId: e.target.value })}
                      required
                    >
                      <option value="">Select caller...</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} - Balance: {formatLamports(a.balance)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Callee Agent (receives)</label>
                    <select
                      value={callForm.calleeId}
                      onChange={(e) => setCallForm({ ...callForm, calleeId: e.target.value })}
                      required
                    >
                      <option value="">Select callee...</option>
                      {agents.filter(a => a.id !== callForm.callerId).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} - Rate: {a.rate} lamports/1K
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Tool Name</label>
                    <input
                      type="text"
                      value={callForm.toolName}
                      onChange={(e) => setCallForm({ ...callForm, toolName: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Tokens Used</label>
                    <input
                      type="number"
                      min="1"
                      value={callForm.tokensUsed}
                      onChange={(e) => setCallForm({ ...callForm, tokensUsed: parseInt(e.target.value) || 0 })}
                      required
                    />
                  </div>

                  <button type="submit" className="btn-execute" disabled={loading || !costPreview?.canExecute}>
                    {loading ? "Executing..." : "⚡ Execute Call"}
                  </button>
                </form>

                {/* Demo Top-up */}
                {callForm.callerId && (
                  <div className="topup-section">
                    <p>Need funds for testing?</p>
                    <button
                      className="btn-secondary"
                      onClick={() => handleTopUp(callForm.callerId, 1000000)}
                    >
                      💰 Add 1M lamports (demo)
                    </button>
                  </div>
                )}
              </div>

              {/* Cost Preview */}
              <div className="preview-panel">
                <h3>Cost Preview</h3>
                {costPreview ? (
                  <div className={`preview-content ${costPreview.canExecute ? "can-execute" : "cannot-execute"}`}>
                    <div className="preview-status">
                      {costPreview.canExecute ? "✅ Can Execute" : "❌ Cannot Execute"}
                    </div>
                    
                    <div className="preview-cost">
                      <span className="cost-label">Total Cost:</span>
                      <span className="cost-value">{formatLamports(costPreview.costLamports)}</span>
                    </div>

                    <div className="preview-breakdown">
                      <h4>Breakdown</h4>
                      <div className="breakdown-item">
                        <span>Rate:</span>
                        <span>{costPreview.breakdown.ratePer1kTokens} lamports/1K</span>
                      </div>
                      <div className="breakdown-item">
                        <span>Token Blocks:</span>
                        <span>{costPreview.breakdown.tokenBlocks}</span>
                      </div>
                      <div className="breakdown-item">
                        <span>Raw Cost:</span>
                        <span>{costPreview.breakdown.rawCost} lamports</span>
                      </div>
                      {costPreview.breakdown.minimumApplied && (
                        <div className="breakdown-item warning">
                          <span>Minimum applied</span>
                        </div>
                      )}
                    </div>

                    <div className="preview-budget">
                      <h4>Budget Status</h4>
                      <div className="budget-item">
                        <span>Current Balance:</span>
                        <span>{formatLamports(costPreview.budgetStatus.currentBalance)}</span>
                      </div>
                      <div className="budget-item">
                        <span>After Call:</span>
                        <span>{formatLamports(costPreview.budgetStatus.afterCallBalance)}</span>
                      </div>
                    </div>

                    {costPreview.warnings.length > 0 && (
                      <div className="preview-warnings">
                        {costPreview.warnings.map((w, i) => (
                          <div key={i} className="warning">{w}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="preview-empty">
                    Select caller and callee to see cost preview
                  </div>
                )}

                {/* Call Result */}
                {callResult && (
                  <div className="call-result">
                    <h3>✅ Call Executed!</h3>
                    <div className="result-item">
                      <span>Cost:</span>
                      <span className="success">{formatLamports(callResult.costLamports)}</span>
                    </div>
                    <div className="result-item">
                      <span>Pricing Source:</span>
                      <span>{callResult.pricingSource}</span>
                    </div>
                    <div className="result-item">
                      <span>Ledger Updated:</span>
                      <span className="success">✓ Yes</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 4. PRICING VISIBILITY */}
        {activeTab === "pricing" && (
          <section className="panel">
            <h2>Pricing Visibility</h2>
            <p className="description">Deterministic pricing makes costs predictable</p>

            {/* Platform Constants */}
            {pricingConstants && (
              <div className="pricing-constants">
                <h3>Platform Constants</h3>
                <div className="constants-grid">
                  <div className="constant">
                    <div className="constant-value">{pricingConstants.minCostLamports}</div>
                    <div className="constant-label">Min Cost (lamports)</div>
                  </div>
                  <div className="constant">
                    <div className="constant-value">{pricingConstants.maxTokensPerCall.toLocaleString()}</div>
                    <div className="constant-label">Max Tokens/Call</div>
                  </div>
                  <div className="constant">
                    <div className="constant-value">{(pricingConstants.platformFeePercent * 100).toFixed(1)}%</div>
                    <div className="constant-label">Platform Fee</div>
                  </div>
                  <div className="constant">
                    <div className="constant-value">{formatLamports(pricingConstants.minPayoutLamports)}</div>
                    <div className="constant-label">Min Payout</div>
                  </div>
                </div>
              </div>
            )}

            {/* Per-Agent Pricing */}
            <div className="agent-pricing">
              <h3>Per-Agent Pricing</h3>
              <div className="pricing-cards">
                {agents.map((agent) => (
                  <div key={agent.id} className="pricing-card">
                    <div className="pricing-header">
                      <span className="agent-name">{agent.name}</span>
                      <span className="agent-id">{agent.id}</span>
                    </div>
                    <div className="pricing-body">
                      <div className="pricing-rate">
                        <span className="rate-value">{agent.rate.toLocaleString()}</span>
                        <span className="rate-unit">lamports / 1K tokens</span>
                      </div>
                      <div className="pricing-sol">
                        ≈ {(agent.rate / 1e9).toFixed(9)} SOL / 1K tokens
                      </div>
                      {pricingConstants && (
                        <div className="pricing-min">
                          Min: {pricingConstants.minCostLamports} lamports
                        </div>
                      )}
                    </div>
                    <div className="pricing-examples">
                      <div className="example">1K tokens = {formatLamports(Math.max(agent.rate, pricingConstants?.minCostLamports || 0))}</div>
                      <div className="example">10K tokens = {formatLamports(agent.rate * 10)}</div>
                      <div className="example">100K tokens = {formatLamports(agent.rate * 100)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 5. SETTLEMENTS & REVENUE */}
        {activeTab === "settlements" && (
          <section className="panel">
            <h2>Settlements & Revenue</h2>

            {/* Pending Payout */}
            {economicState && economicState.pendingLamports > 0 && (
              <div className="pending-payout">
                <div className="payout-info">
                  <h3>Pending Payout</h3>
                  <div className="payout-amount">{formatLamports(economicState.pendingLamports)}</div>
                  <p>Ready to settle to your wallet</p>
                </div>
                <button
                  className="btn-settle"
                  onClick={() => handleSettle(selectedAgent)}
                  disabled={loading || !pricingConstants || economicState.pendingLamports < pricingConstants.minPayoutLamports}
                >
                  Settle Now
                </button>
                {pricingConstants && economicState.pendingLamports < pricingConstants.minPayoutLamports && (
                  <p className="settle-warning">
                    Minimum payout: {formatLamports(pricingConstants.minPayoutLamports)}
                  </p>
                )}
              </div>
            )}

            {/* Settlement History */}
            <div className="settlements-section">
              <h3>Settlement History</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Gross</th>
                    <th>Platform Fee</th>
                    <th>Net Payout</th>
                    <th>Status</th>
                    <th>TX</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.length === 0 && (
                    <tr><td colSpan={6} className="empty">No settlements yet</td></tr>
                  )}
                  {settlements.map((s, i) => (
                    <tr key={i}>
                      <td>{formatTime(s.createdAt)}</td>
                      <td>{formatLamports(s.grossLamports)}</td>
                      <td className="fee">{formatLamports(s.platformFeeLamports)}</td>
                      <td className="earned">{formatLamports(s.netLamports)}</td>
                      <td>
                        <span className={`status-badge ${s.status}`}>{s.status}</span>
                      </td>
                      <td>
                        {s.txSignature ? (
                          <a 
                            href={`https://solscan.io/tx/${s.txSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tx-link"
                          >
                            {s.txSignature.slice(0, 8)}...
                          </a>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Platform Revenue (Admin View) */}
            {platformRevenue && (
              <div className="platform-revenue">
                <h3>Platform Revenue</h3>
                <div className="revenue-stats">
                  <div className="revenue-stat">
                    <div className="revenue-value">{formatLamports(platformRevenue.totalFeesLamports)}</div>
                    <div className="revenue-label">Total Platform Fees</div>
                  </div>
                  <div className="revenue-stat">
                    <div className="revenue-value">{platformRevenue.settlementCount}</div>
                    <div className="revenue-label">Total Settlements</div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 6. DEPOSITS */}
        {activeTab === "deposits" && (
          <section className="panel">
            <h2>Deposit & Withdraw SOL</h2>
            <p className="description">Fund your agent account with real SOL or withdraw to your wallet</p>

            {/* Agent Selector */}
            <div className="form-group">
              <label>Select Agent</label>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                ))}
              </select>
            </div>

            {/* Current Balance */}
            {economicState && (
              <div className="balance-card">
                <div className="balance-info">
                  <span className="balance-label">Current Balance</span>
                  <span className="balance-value">{formatLamports(economicState.balanceLamports)}</span>
                </div>
              </div>
            )}

            {/* Treasury Address */}
            {depositAddress && (
              <div className="deposit-section">
                <h3>Deposit SOL</h3>
                <div className="treasury-info">
                  <label>Treasury Address ({depositAddress.network})</label>
                  <div className="address-display">
                    <code>{depositAddress.treasuryAddress}</code>
                    <button 
                      className="btn-copy"
                      onClick={() => {
                        navigator.clipboard.writeText(depositAddress.treasuryAddress);
                        showMessage("success", "Address copied!");
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <p className="hint">{depositAddress.instructions}</p>
                </div>

                {/* Create Deposit Intent */}
                <div className="form-row">
                  <div className="form-group">
                    <label>Expected Amount (optional)</label>
                    <input
                      type="number"
                      placeholder="Amount in lamports"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                    />
                  </div>
                  <button 
                    className="btn-primary"
                    onClick={handleCreateDepositIntent}
                    disabled={loading}
                  >
                    Create Deposit Intent
                  </button>
                </div>

                {/* Show Intent if created */}
                {depositIntent && (
                  <div className="intent-card">
                    <h4>Deposit Intent Created</h4>
                    <div className="intent-details">
                      <p><strong>Reference:</strong> {depositIntent.reference}</p>
                      <p><strong>Expires:</strong> {formatTime(depositIntent.expiresAt)}</p>
                      {depositIntent.expectedAmountLamports && (
                        <p><strong>Expected:</strong> {formatLamports(depositIntent.expectedAmountLamports)}</p>
                      )}
                    </div>
                    <div className="qr-code">
                      <img src={depositIntent.qrCodeData} alt="Deposit QR Code" />
                    </div>
                    <ul className="instructions">
                      {depositIntent.instructions.map((inst, i) => (
                        <li key={i}>{inst}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Verify Transaction */}
                <div className="verify-section">
                  <h4>Verify a Transaction</h4>
                  <div className="form-row">
                    <input
                      type="text"
                      placeholder="Solana transaction signature"
                      value={verifyTxSignature}
                      onChange={(e) => setVerifyTxSignature(e.target.value)}
                      className="input-wide"
                    />
                    <button 
                      className="btn-primary"
                      onClick={handleVerifyDeposit}
                      disabled={loading || !verifyTxSignature}
                    >
                      Verify Deposit
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Withdraw Section */}
            <div className="deposit-section">
              <h3>Withdraw SOL</h3>
              <div className="form-group">
                <label>Amount (lamports)</label>
                <input
                  type="number"
                  placeholder="Amount to withdraw"
                  value={withdrawForm.amount}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, amount: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Destination Wallet Address</label>
                <input
                  type="text"
                  placeholder="Solana wallet address"
                  value={withdrawForm.toAddress}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, toAddress: e.target.value })}
                />
              </div>
              <button 
                className="btn-danger"
                onClick={handleWithdraw}
                disabled={loading || !withdrawForm.amount || !withdrawForm.toAddress}
              >
                Withdraw SOL
              </button>
            </div>

            {/* Pending Intents */}
            {pendingIntents.length > 0 && (
              <div className="deposits-history">
                <h3>Pending Deposit Intents</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Expected Amount</th>
                      <th>Expires</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingIntents.map((pi, i) => (
                      <tr key={i}>
                        <td><code>{pi.reference}</code></td>
                        <td>{pi.expectedAmountLamports ? formatLamports(pi.expectedAmountLamports) : "-"}</td>
                        <td>{formatTime(pi.expiresAt)}</td>
                        <td><span className={`status-badge ${pi.status}`}>{pi.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Deposit History */}
            <div className="deposits-history">
              <h3>Deposit History</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>TX Signature</th>
                  </tr>
                </thead>
                <tbody>
                  {depositHistory.length === 0 && (
                    <tr><td colSpan={4} className="empty">No deposits yet</td></tr>
                  )}
                  {depositHistory.map((d, i) => (
                    <tr key={i}>
                      <td>{formatTime(d.createdAt)}</td>
                      <td className="earned">{formatLamports(d.amountLamports)}</td>
                      <td><span className={`status-badge ${d.status}`}>{d.status}</span></td>
                      <td>
                        <a 
                          href={`https://solscan.io/tx/${d.txSignature}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tx-link"
                        >
                          {d.txSignature.slice(0, 12)}...
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
    min-height: 100vh;
    color: #e2e8f0;
  }
  .page { max-width: 1400px; margin: 0 auto; padding: 20px; }
  
  /* Navigation */
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

  /* Auth Panel */
  .auth-panel {
    text-align: center;
    padding: 80px 24px;
    background: rgba(30, 27, 75, 0.6);
    border-radius: 24px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .auth-panel h1 { font-size: 32px; margin-bottom: 16px; }
  .auth-panel p { color: #94a3b8; margin-bottom: 32px; }
  .auth-form { display: flex; gap: 16px; justify-content: center; }
  .input-lg {
    padding: 16px 24px;
    font-size: 16px;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 12px;
    color: #e2e8f0;
    width: 300px;
  }

  /* Hero */
  .hero {
    text-align: center;
    padding: 32px;
    background: rgba(30, 27, 75, 0.6);
    border-radius: 24px;
    margin-bottom: 24px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .hero h1 { font-size: 28px; margin-bottom: 8px; }
  .hero p { color: #94a3b8; }

  /* Tabs */
  .tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .tab {
    padding: 12px 20px;
    background: rgba(30, 27, 75, 0.6);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 12px;
    color: #a5b4fc;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 14px;
  }
  .tab:hover { border-color: rgba(139, 92, 246, 0.5); }
  .tab.active {
    background: rgba(139, 92, 246, 0.2);
    border-color: #8b5cf6;
    color: #c4b5fd;
  }

  /* Panels */
  .panel {
    background: rgba(30, 27, 75, 0.6);
    border-radius: 24px;
    padding: 32px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .panel h2 { font-size: 24px; margin-bottom: 8px; }
  .description { color: #94a3b8; margin-bottom: 24px; }

  /* Forms */
  .form { max-width: 500px; }
  .form-group { margin-bottom: 20px; }
  .form-group label {
    display: block;
    margin-bottom: 8px;
    color: #c4b5fd;
    font-weight: 500;
  }
  .form-group input,
  .form-group select {
    width: 100%;
    padding: 12px 16px;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 14px;
  }
  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #8b5cf6;
  }
  .hint { font-size: 12px; color: #64748b; margin-top: 4px; display: block; }

  /* Buttons */
  .btn-primary {
    padding: 14px 28px;
    background: linear-gradient(135deg, #8b5cf6, #6366f1);
    border: none;
    border-radius: 12px;
    color: white;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(139, 92, 246, 0.4); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

  .btn-secondary {
    padding: 10px 20px;
    background: rgba(139, 92, 246, 0.2);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 8px;
    color: #c4b5fd;
    cursor: pointer;
  }
  .btn-secondary:hover { background: rgba(139, 92, 246, 0.3); }

  .btn-execute {
    width: 100%;
    padding: 16px 28px;
    background: linear-gradient(135deg, #22c55e, #16a34a);
    border: none;
    border-radius: 12px;
    color: white;
    font-weight: 700;
    font-size: 16px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-execute:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(34, 197, 94, 0.4); }
  .btn-execute:disabled { opacity: 0.5; cursor: not-allowed; background: #64748b; transform: none; }

  .btn-settle {
    padding: 14px 28px;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    border: none;
    border-radius: 12px;
    color: white;
    font-weight: 600;
    cursor: pointer;
  }

  /* Toast */
  .toast {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    border-radius: 12px;
    font-weight: 500;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  }
  .toast-success { background: #22c55e; color: white; }
  .toast-error { background: #ef4444; color: white; }
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  /* Stats Grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .stat-card {
    background: rgba(15, 23, 42, 0.6);
    padding: 20px;
    border-radius: 16px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .stat-card.primary { border-color: #8b5cf6; }
  .stat-card.success { border-color: #22c55e; }
  .stat-card.danger { border-color: #ef4444; }
  .stat-card.info { border-color: #06b6d4; }
  .stat-value { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  .stat-label { color: #94a3b8; font-size: 14px; }

  /* Metrics Row */
  .metrics-row {
    display: flex;
    gap: 24px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .metric {
    display: flex;
    gap: 8px;
  }
  .metric-label { color: #94a3b8; }
  .metric-value { color: #c4b5fd; font-weight: 500; }

  /* Data Tables */
  .data-table {
    width: 100%;
    border-collapse: collapse;
  }
  .data-table th,
  .data-table td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid rgba(139, 92, 246, 0.1);
  }
  .data-table th {
    color: #94a3b8;
    font-weight: 500;
    font-size: 12px;
    text-transform: uppercase;
  }
  .data-table .empty { text-align: center; color: #64748b; padding: 32px; }
  .data-table .cost { color: #f87171; }
  .data-table .earned { color: #4ade80; }
  .data-table .fee { color: #fbbf24; }
  .tx-link { color: #60a5fa; text-decoration: none; }
  .tx-link:hover { text-decoration: underline; }

  /* Status Badges */
  .status-badge {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
  }
  .status-badge.completed { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
  .status-badge.pending { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
  .status-badge.failed { background: rgba(239, 68, 68, 0.2); color: #f87171; }

  /* Execute Grid */
  .execute-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }
  @media (max-width: 900px) {
    .execute-grid { grid-template-columns: 1fr; }
  }

  /* Preview Panel */
  .preview-panel {
    background: rgba(15, 23, 42, 0.6);
    padding: 24px;
    border-radius: 16px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .preview-panel h3 { margin-bottom: 16px; }
  .preview-empty { color: #64748b; text-align: center; padding: 40px; }
  .preview-content.can-execute { border-left: 4px solid #22c55e; padding-left: 16px; }
  .preview-content.cannot-execute { border-left: 4px solid #ef4444; padding-left: 16px; }
  .preview-status { font-size: 18px; font-weight: 600; margin-bottom: 16px; }
  .preview-cost { margin-bottom: 16px; }
  .cost-label { color: #94a3b8; }
  .cost-value { font-size: 24px; font-weight: 700; color: #c4b5fd; margin-left: 12px; }
  .preview-breakdown,
  .preview-budget { margin-bottom: 16px; }
  .preview-breakdown h4,
  .preview-budget h4 { font-size: 14px; color: #94a3b8; margin-bottom: 8px; }
  .breakdown-item,
  .budget-item {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    font-size: 14px;
  }
  .breakdown-item.warning { color: #fbbf24; }
  .preview-warnings { margin-top: 12px; }
  .preview-warnings .warning { color: #fbbf24; font-size: 13px; }

  /* Call Result */
  .call-result {
    margin-top: 24px;
    padding: 20px;
    background: rgba(34, 197, 94, 0.1);
    border-radius: 12px;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }
  .call-result h3 { color: #4ade80; margin-bottom: 12px; }
  .result-item {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
  }
  .result-item .success { color: #4ade80; }

  /* Top-up Section */
  .topup-section {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid rgba(139, 92, 246, 0.2);
  }
  .topup-section p { color: #64748b; font-size: 13px; margin-bottom: 8px; }

  /* Agents List */
  .agents-list { margin-top: 32px; }
  .agents-list h3 { margin-bottom: 16px; color: #94a3b8; }
  .agent-card {
    padding: 16px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 12px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid transparent;
  }
  .agent-card:hover { border-color: rgba(139, 92, 246, 0.3); }
  .agent-name { font-weight: 600; margin-bottom: 4px; }
  .agent-id { color: #64748b; font-size: 12px; margin-bottom: 8px; }
  .agent-stats { display: flex; gap: 16px; font-size: 13px; color: #94a3b8; }

  /* Pricing */
  .pricing-constants { margin-bottom: 32px; }
  .constants-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px;
  }
  .constant {
    background: rgba(15, 23, 42, 0.6);
    padding: 20px;
    border-radius: 12px;
    text-align: center;
  }
  .constant-value { font-size: 20px; font-weight: 700; color: #8b5cf6; }
  .constant-label { color: #94a3b8; font-size: 12px; margin-top: 4px; }

  .pricing-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }
  .pricing-card {
    background: rgba(15, 23, 42, 0.6);
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }
  .pricing-header {
    padding: 16px;
    background: rgba(139, 92, 246, 0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .pricing-header .agent-name { font-weight: 600; }
  .pricing-header .agent-id { color: #64748b; font-size: 12px; }
  .pricing-body { padding: 20px; }
  .pricing-rate { margin-bottom: 8px; }
  .rate-value { font-size: 28px; font-weight: 700; color: #8b5cf6; }
  .rate-unit { color: #94a3b8; font-size: 14px; margin-left: 8px; }
  .pricing-sol { color: #64748b; font-size: 13px; margin-bottom: 12px; }
  .pricing-min { color: #fbbf24; font-size: 12px; }
  .pricing-examples {
    padding: 16px;
    border-top: 1px solid rgba(139, 92, 246, 0.1);
  }
  .pricing-examples .example {
    padding: 6px 0;
    font-size: 13px;
    color: #94a3b8;
  }

  /* Settlements */
  .pending-payout {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 24px;
    background: linear-gradient(135deg, rgba(251, 191, 36, 0.1), rgba(245, 158, 11, 0.1));
    border-radius: 16px;
    border: 1px solid rgba(251, 191, 36, 0.3);
    margin-bottom: 24px;
  }
  .payout-info { flex: 1; }
  .payout-info h3 { margin-bottom: 8px; }
  .payout-amount { font-size: 28px; font-weight: 700; color: #fbbf24; }
  .settle-warning { color: #f87171; font-size: 12px; margin-top: 8px; }

  .settlements-section,
  .history-section { margin-top: 24px; }
  .settlements-section h3,
  .history-section h3 { margin-bottom: 16px; color: #c4b5fd; }

  .platform-revenue { margin-top: 32px; }
  .platform-revenue h3 { margin-bottom: 16px; }
  .revenue-stats { display: flex; gap: 24px; }
  .revenue-stat {
    background: rgba(15, 23, 42, 0.6);
    padding: 24px;
    border-radius: 12px;
    text-align: center;
  }
  .revenue-value { font-size: 24px; font-weight: 700; color: #8b5cf6; }
  .revenue-label { color: #94a3b8; font-size: 14px; margin-top: 4px; }

  /* Deposit Section Styles */
  .balance-card {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(6, 182, 212, 0.2));
    padding: 24px;
    border-radius: 16px;
    margin-bottom: 24px;
    border: 1px solid rgba(139, 92, 246, 0.3);
  }
  .balance-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .balance-label { color: #a5b4fc; font-size: 14px; }
  .balance-value { font-size: 28px; font-weight: 700; color: #8b5cf6; }

  .deposit-section {
    background: rgba(15, 23, 42, 0.6);
    padding: 24px;
    border-radius: 16px;
    margin-bottom: 24px;
  }
  .deposit-section h3 { margin-bottom: 16px; color: #c4b5fd; }
  .deposit-section h4 { margin: 24px 0 12px; color: #a5b4fc; }

  .treasury-info { margin-bottom: 24px; }
  .treasury-info label { display: block; margin-bottom: 8px; color: #94a3b8; }
  .address-display {
    display: flex;
    gap: 12px;
    align-items: center;
    background: rgba(0, 0, 0, 0.3);
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 8px;
  }
  .address-display code {
    flex: 1;
    font-family: monospace;
    font-size: 14px;
    color: #06b6d4;
    word-break: break-all;
  }
  .btn-copy {
    background: rgba(139, 92, 246, 0.3);
    color: #c4b5fd;
    border: none;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-copy:hover { background: rgba(139, 92, 246, 0.5); }

  .form-row {
    display: flex;
    gap: 16px;
    align-items: flex-end;
    margin-bottom: 16px;
  }
  .form-row .form-group { flex: 1; margin-bottom: 0; }
  .input-wide { flex: 1; }

  .intent-card {
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 12px;
    padding: 20px;
    margin-top: 16px;
  }
  .intent-card h4 { color: #8b5cf6; margin-bottom: 12px; }
  .intent-details p { margin: 8px 0; color: #94a3b8; }
  .intent-details strong { color: #c4b5fd; }
  .qr-code {
    text-align: center;
    margin: 20px 0;
    padding: 16px;
    background: white;
    border-radius: 8px;
    display: inline-block;
  }
  .qr-code img { max-width: 200px; height: auto; }
  .instructions {
    list-style: decimal;
    padding-left: 20px;
    color: #94a3b8;
  }
  .instructions li { margin: 8px 0; }

  .verify-section {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid rgba(139, 92, 246, 0.2);
  }

  .btn-danger {
    background: linear-gradient(135deg, #dc2626, #b91c1c);
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-danger:hover { filter: brightness(1.1); }
  .btn-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .deposits-history { margin-top: 32px; }
  .deposits-history h3 { margin-bottom: 16px; color: #c4b5fd; }
`;
