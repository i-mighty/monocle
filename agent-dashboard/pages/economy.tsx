import { useEffect, useState } from "react";
import Layout from "../components/Layout";
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
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <form onSubmit={handleLogin} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-8 w-[360px]">
          <h1 className="text-white text-2xl font-bold mb-2">Economy Control Panel</h1>
          <p className="text-zinc-500 text-sm mb-6">Enter your API key to access the control panel</p>
          <input
            id="apiKeyInput"
            type="password"
            placeholder="Enter API Key"
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm mb-4 focus:outline-none focus:border-zinc-600 transition-colors"
          />
          <button type="submit" className="w-full py-3 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors">
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <Layout title="Economy">
      {/* Message Toast */}
      {message && (
        <div className={`fixed top-5 right-5 px-6 py-4 rounded-xl font-medium z-50 ${
          message.type === "success" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
        }`}>
          {message.text}
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Economy Control Panel</h1>
        <p className="text-zinc-500 text-sm">Register agents, execute calls, view economics, and manage settlements</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(["register", "state", "execute", "pricing", "settlements", "deposits"] as const).map((tab, i) => (
          <button
            key={tab}
            className={`px-4 py-2.5 rounded-lg text-sm transition-colors ${
              activeTab === tab
                ? "bg-white text-zinc-900 font-medium"
                : "bg-zinc-900/50 border border-zinc-800/60 text-zinc-500 hover:text-white hover:border-zinc-600"
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {i + 1}. {tab === "register" ? "Register" : tab === "state" ? "State" : tab === "execute" ? "Execute" : tab === "pricing" ? "Pricing" : tab === "settlements" ? "Settlements" : "Deposits"}
          </button>
        ))}
      </div>

      {/* Content Panels */}
      <div>
        {/* 1. REGISTER AGENT */}
        {activeTab === "register" && (
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-1">Register New Agent</h2>
            <p className="text-zinc-500 text-sm mb-6">Create an agent that can participate in the token economy</p>
            
            <form onSubmit={handleRegister} className="max-w-lg">
              <div className="mb-5">
                <label className="block mb-2 text-zinc-400 text-sm font-medium">Agent ID *</label>
                <input
                  type="text"
                  placeholder="my-agent-001"
                  value={registerForm.agentId}
                  onChange={(e) => setRegisterForm({ ...registerForm, agentId: e.target.value })}
                  required
                  className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600 transition-colors"
                />
                <span className="text-xs text-zinc-600 mt-1 block">Unique identifier for your agent</span>
              </div>

              <div className="mb-5">
                <label className="block mb-2 text-zinc-400 text-sm font-medium">Display Name</label>
                <input
                  type="text"
                  placeholder="My Awesome Agent"
                  value={registerForm.name || ""}
                  onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                  className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600 transition-colors"
                />
              </div>

              <div className="mb-5">
                <label className="block mb-2 text-zinc-400 text-sm font-medium">Wallet Address</label>
                <input
                  type="text"
                  placeholder="Solana public key for settlements"
                  value={registerForm.publicKey || ""}
                  onChange={(e) => setRegisterForm({ ...registerForm, publicKey: e.target.value })}
                  className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600 transition-colors"
                />
                <span className="text-xs text-zinc-600 mt-1 block">Your Solana wallet address for receiving payments</span>
              </div>

              <div className="mb-5">
                <label className="block mb-2 text-zinc-400 text-sm font-medium">Rate per 1K Tokens (lamports)</label>
                <input
                  type="number"
                  min="1"
                  value={registerForm.ratePer1kTokens || 1000}
                  onChange={(e) => setRegisterForm({ ...registerForm, ratePer1kTokens: parseInt(e.target.value) || 1000 })}
                  className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600 transition-colors"
                />
                <span className="text-xs text-zinc-600 mt-1 block">
                  {registerForm.ratePer1kTokens || 1000} lamports = {((registerForm.ratePer1kTokens || 1000) / 1e9).toFixed(9)} SOL per 1K tokens
                </span>
              </div>

              <button type="submit" className="px-6 py-3 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50" disabled={loading}>
                {loading ? "Registering..." : "Register Agent"}
              </button>
            </form>

            {/* Existing Agents */}
            <div className="mt-8">
              <h3 className="text-zinc-500 text-sm font-medium mb-4">Registered Agents ({agents.length})</h3>
              {agents.map((agent) => (
                <div key={agent.id} className="p-4 bg-zinc-950 rounded-lg mb-2 cursor-pointer border border-transparent hover:border-zinc-800/60 transition-colors" onClick={() => setSelectedAgent(agent.id)}>
                  <div className="text-white font-medium text-sm">{agent.name}</div>
                  <div className="text-zinc-600 text-xs mb-2">{agent.id}</div>
                  <div className="flex gap-4 text-xs text-zinc-500">
                    <span>Rate: {agent.rate} lamports/1K</span>
                    <span>Balance: {formatLamports(agent.balance)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. ECONOMIC STATE */}
        {activeTab === "state" && (
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Economic State</h2>
            
            <div className="mb-5">
              <label className="block mb-2 text-zinc-400 text-sm font-medium">Select Agent</label>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="w-full max-w-lg px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                ))}
              </select>
            </div>

            {economicState && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <div className="bg-zinc-950 border border-zinc-800/60 rounded-xl p-5">
                    <div className="text-xl font-bold text-white">{formatLamports(economicState.balanceLamports)}</div>
                    <div className="text-zinc-500 text-sm">Current Balance</div>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800/60 rounded-xl p-5">
                    <div className="text-xl font-bold text-white">{formatLamports(economicState.pendingLamports)}</div>
                    <div className="text-zinc-500 text-sm">Pending Earnings</div>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800/60 rounded-xl p-5">
                    <div className="text-xl font-bold text-white">{formatLamports(economicState.totalSpentLamports || 0)}</div>
                    <div className="text-zinc-500 text-sm">Total Spend</div>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800/60 rounded-xl p-5">
                    <div className="text-xl font-bold text-white">{formatLamports(economicState.totalEarnedLamports || 0)}</div>
                    <div className="text-zinc-500 text-sm">Total Revenue</div>
                  </div>
                </div>

                <div className="flex gap-6 mb-6 flex-wrap text-sm">
                  <div className="flex gap-2">
                    <span className="text-zinc-500">Calls Made:</span>
                    <span className="text-white">{economicState.totalCallsMade || 0}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-zinc-500">Calls Received:</span>
                    <span className="text-white">{economicState.totalCallsReceived || 0}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-zinc-500">Rate:</span>
                    <span className="text-white">{economicState.ratePer1kTokens} lamports/1K</span>
                  </div>
                </div>

                {/* Recent Tool Calls */}
                <div className="mt-6">
                  <h3 className="text-zinc-400 text-sm font-medium mb-3">Recent Tool Calls (Outgoing)</h3>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-800/60">
                        <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Time</th>
                        <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Callee</th>
                        <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Tool</th>
                        <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Tokens</th>
                        <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {toolCalls.length === 0 && (
                        <tr><td colSpan={5} className="text-center text-zinc-600 py-8 text-sm">No tool calls yet</td></tr>
                      )}
                      {toolCalls.slice(0, 10).map((call, i) => (
                        <tr key={i} className="border-b border-zinc-800/40">
                          <td className="px-3 py-3 text-sm text-zinc-400">{formatTime(call.timestamp)}</td>
                          <td className="px-3 py-3 text-sm text-white">{call.calleeId}</td>
                          <td className="px-3 py-3 text-sm text-white">{call.toolName}</td>
                          <td className="px-3 py-3 text-sm text-white">{call.tokensUsed}</td>
                          <td className="px-3 py-3 text-sm text-red-400">{formatLamports(call.costLamports)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Earnings */}
                <div className="mt-6">
                  <h3 className="text-zinc-400 text-sm font-medium mb-3">Recent Earnings (Incoming)</h3>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-800/60">
                        <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Time</th>
                        <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Caller</th>
                        <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Tool</th>
                        <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Tokens</th>
                        <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Earned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {earnings.length === 0 && (
                        <tr><td colSpan={5} className="text-center text-zinc-600 py-8 text-sm">No earnings yet</td></tr>
                      )}
                      {earnings.slice(0, 10).map((call, i) => (
                        <tr key={i} className="border-b border-zinc-800/40">
                          <td className="px-3 py-3 text-sm text-zinc-400">{formatTime(call.timestamp)}</td>
                          <td className="px-3 py-3 text-sm text-white">{call.callerId}</td>
                          <td className="px-3 py-3 text-sm text-white">{call.toolName}</td>
                          <td className="px-3 py-3 text-sm text-white">{call.tokensUsed}</td>
                          <td className="px-3 py-3 text-sm text-emerald-400">{formatLamports(call.costLamports)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* 3. EXECUTE CALL */}
        {activeTab === "execute" && (
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-1">Execute Tool Call</h2>
            <p className="text-zinc-500 text-sm mb-6">
              <strong className="text-white">The Killer Feature:</strong> Execute a real economic transaction between agents
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Call Form */}
              <div>
                <form onSubmit={handleExecuteCall}>
                  <div className="mb-5">
                    <label className="block mb-2 text-zinc-400 text-sm font-medium">Caller Agent (pays)</label>
                    <select
                      value={callForm.callerId}
                      onChange={(e) => setCallForm({ ...callForm, callerId: e.target.value })}
                      required
                      className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
                    >
                      <option value="">Select caller...</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} - Balance: {formatLamports(a.balance)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-5">
                    <label className="block mb-2 text-zinc-400 text-sm font-medium">Callee Agent (receives)</label>
                    <select
                      value={callForm.calleeId}
                      onChange={(e) => setCallForm({ ...callForm, calleeId: e.target.value })}
                      required
                      className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
                    >
                      <option value="">Select callee...</option>
                      {agents.filter(a => a.id !== callForm.callerId).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} - Rate: {a.rate} lamports/1K
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-5">
                    <label className="block mb-2 text-zinc-400 text-sm font-medium">Tool Name</label>
                    <input
                      type="text"
                      value={callForm.toolName}
                      onChange={(e) => setCallForm({ ...callForm, toolName: e.target.value })}
                      required
                      className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
                    />
                  </div>

                  <div className="mb-5">
                    <label className="block mb-2 text-zinc-400 text-sm font-medium">Tokens Used</label>
                    <input
                      type="number"
                      min="1"
                      value={callForm.tokensUsed}
                      onChange={(e) => setCallForm({ ...callForm, tokensUsed: parseInt(e.target.value) || 0 })}
                      required
                      className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
                    />
                  </div>

                  <button type="submit" className="w-full py-3 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={loading || !costPreview?.canExecute}>
                    {loading ? "Executing..." : "Execute Call"}
                  </button>
                </form>

                {/* Demo Top-up */}
                {callForm.callerId && (
                  <div className="mt-6 pt-4 border-t border-zinc-800/60">
                    <p className="text-zinc-600 text-xs mb-2">Need funds for testing?</p>
                    <button
                      className="px-4 py-2 border border-zinc-800/60 rounded-lg text-zinc-400 text-sm hover:text-white hover:border-zinc-600 transition-colors"
                      onClick={() => handleTopUp(callForm.callerId, 1000000)}
                    >
                      Add 1M lamports (demo)
                    </button>
                  </div>
                )}
              </div>

              {/* Cost Preview */}
              <div className="bg-zinc-950 border border-zinc-800/60 rounded-xl p-5">
                <h3 className="text-white font-medium mb-4">Cost Preview</h3>
                {costPreview ? (
                  <div className={`pl-4 ${costPreview.canExecute ? "border-l-4 border-emerald-500" : "border-l-4 border-red-500"}`}>
                    <div className="text-lg font-semibold mb-4">
                      {costPreview.canExecute ? <span className="text-emerald-500">Can Execute</span> : <span className="text-red-500">Cannot Execute</span>}
                    </div>
                    
                    <div className="mb-4">
                      <span className="text-zinc-500 text-sm">Total Cost: </span>
                      <span className="text-xl font-bold text-white ml-2">{formatLamports(costPreview.costLamports)}</span>
                    </div>

                    <div className="mb-4">
                      <h4 className="text-zinc-500 text-xs uppercase mb-2">Breakdown</h4>
                      <div className="flex justify-between py-1.5 text-sm">
                        <span className="text-zinc-500">Rate:</span>
                        <span className="text-white">{costPreview.breakdown.ratePer1kTokens} lamports/1K</span>
                      </div>
                      <div className="flex justify-between py-1.5 text-sm">
                        <span className="text-zinc-500">Token Blocks:</span>
                        <span className="text-white">{costPreview.breakdown.tokenBlocks}</span>
                      </div>
                      <div className="flex justify-between py-1.5 text-sm">
                        <span className="text-zinc-500">Raw Cost:</span>
                        <span className="text-white">{costPreview.breakdown.rawCost} lamports</span>
                      </div>
                      {costPreview.breakdown.minimumApplied && (
                        <div className="text-amber-500 text-sm py-1">Minimum applied</div>
                      )}
                    </div>

                    <div className="mb-4">
                      <h4 className="text-zinc-500 text-xs uppercase mb-2">Budget Status</h4>
                      <div className="flex justify-between py-1.5 text-sm">
                        <span className="text-zinc-500">Current Balance:</span>
                        <span className="text-white">{formatLamports(costPreview.budgetStatus.currentBalance)}</span>
                      </div>
                      <div className="flex justify-between py-1.5 text-sm">
                        <span className="text-zinc-500">After Call:</span>
                        <span className="text-white">{formatLamports(costPreview.budgetStatus.afterCallBalance)}</span>
                      </div>
                    </div>

                    {costPreview.warnings.length > 0 && (
                      <div className="mt-3">
                        {costPreview.warnings.map((w, i) => (
                          <div key={i} className="text-amber-500 text-xs">{w}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-zinc-600 text-center py-10 text-sm">
                    Select caller and callee to see cost preview
                  </div>
                )}

                {/* Call Result */}
                {callResult && (
                  <div className="mt-6 p-5 bg-emerald-950/30 border border-emerald-500/20 rounded-xl">
                    <h3 className="text-emerald-500 font-medium mb-3">Call Executed!</h3>
                    <div className="flex justify-between py-2 text-sm">
                      <span className="text-zinc-500">Cost:</span>
                      <span className="text-emerald-400">{formatLamports(callResult.costLamports)}</span>
                    </div>
                    <div className="flex justify-between py-2 text-sm">
                      <span className="text-zinc-500">Pricing Source:</span>
                      <span className="text-white">{callResult.pricingSource}</span>
                    </div>
                    <div className="flex justify-between py-2 text-sm">
                      <span className="text-zinc-500">Ledger Updated:</span>
                      <span className="text-emerald-400">Yes</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 4. PRICING VISIBILITY */}
        {activeTab === "pricing" && (
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-1">Pricing Visibility</h2>
            <p className="text-zinc-500 text-sm mb-6">Deterministic pricing makes costs predictable</p>

            {/* Platform Constants */}
            {pricingConstants && (
              <div className="mb-8">
                <h3 className="text-zinc-400 text-sm font-medium mb-3">Platform Constants</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-zinc-950 rounded-xl p-5 text-center">
                    <div className="text-xl font-bold text-white">{pricingConstants.minCostLamports}</div>
                    <div className="text-zinc-500 text-xs mt-1">Min Cost (lamports)</div>
                  </div>
                  <div className="bg-zinc-950 rounded-xl p-5 text-center">
                    <div className="text-xl font-bold text-white">{pricingConstants.maxTokensPerCall.toLocaleString()}</div>
                    <div className="text-zinc-500 text-xs mt-1">Max Tokens/Call</div>
                  </div>
                  <div className="bg-zinc-950 rounded-xl p-5 text-center">
                    <div className="text-xl font-bold text-white">{(pricingConstants.platformFeePercent * 100).toFixed(1)}%</div>
                    <div className="text-zinc-500 text-xs mt-1">Platform Fee</div>
                  </div>
                  <div className="bg-zinc-950 rounded-xl p-5 text-center">
                    <div className="text-xl font-bold text-white">{formatLamports(pricingConstants.minPayoutLamports)}</div>
                    <div className="text-zinc-500 text-xs mt-1">Min Payout</div>
                  </div>
                </div>
              </div>
            )}

            {/* Per-Agent Pricing */}
            <div>
              <h3 className="text-zinc-400 text-sm font-medium mb-3">Per-Agent Pricing</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {agents.map((agent) => (
                  <div key={agent.id} className="bg-zinc-950 border border-zinc-800/60 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-800/60 flex justify-between items-center">
                      <span className="text-white font-medium text-sm">{agent.name}</span>
                      <span className="text-zinc-600 text-xs">{agent.id}</span>
                    </div>
                    <div className="p-4">
                      <div className="mb-2">
                        <span className="text-2xl font-bold text-white">{agent.rate.toLocaleString()}</span>
                        <span className="text-zinc-500 text-sm ml-2">lamports / 1K tokens</span>
                      </div>
                      <div className="text-zinc-600 text-xs mb-3">
                        â‰ˆ {(agent.rate / 1e9).toFixed(9)} SOL / 1K tokens
                      </div>
                      {pricingConstants && (
                        <div className="text-amber-500/80 text-xs">
                          Min: {pricingConstants.minCostLamports} lamports
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-3 border-t border-zinc-800/60 space-y-1">
                      <div className="text-zinc-500 text-xs">1K tokens = {formatLamports(Math.max(agent.rate, pricingConstants?.minCostLamports || 0))}</div>
                      <div className="text-zinc-500 text-xs">10K tokens = {formatLamports(agent.rate * 10)}</div>
                      <div className="text-zinc-500 text-xs">100K tokens = {formatLamports(agent.rate * 100)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 5. SETTLEMENTS & REVENUE */}
        {activeTab === "settlements" && (
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Settlements &amp; Revenue</h2>

            {/* Pending Payout */}
            {economicState && economicState.pendingLamports > 0 && (
              <div className="flex items-center gap-6 p-5 bg-zinc-950 border border-amber-500/20 rounded-xl mb-6">
                <div className="flex-1">
                  <h3 className="text-white font-medium mb-1">Pending Payout</h3>
                  <div className="text-2xl font-bold text-amber-400">{formatLamports(economicState.pendingLamports)}</div>
                  <p className="text-zinc-500 text-xs mt-1">Ready to settle to your wallet</p>
                </div>
                <button
                  className="px-6 py-3 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
                  onClick={() => handleSettle(selectedAgent)}
                  disabled={loading || !pricingConstants || economicState.pendingLamports < pricingConstants.minPayoutLamports}
                >
                  Settle Now
                </button>
                {pricingConstants && economicState.pendingLamports < pricingConstants.minPayoutLamports && (
                  <p className="text-red-400 text-xs">
                    Minimum payout: {formatLamports(pricingConstants.minPayoutLamports)}
                  </p>
                )}
              </div>
            )}

            {/* Settlement History */}
            <div className="mt-6">
              <h3 className="text-zinc-400 text-sm font-medium mb-3">Settlement History</h3>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800/60">
                    <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Date</th>
                    <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Gross</th>
                    <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Platform Fee</th>
                    <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Net Payout</th>
                    <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Status</th>
                    <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">TX</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-zinc-600 py-8 text-sm">No settlements yet</td></tr>
                  )}
                  {settlements.map((s, i) => (
                    <tr key={i} className="border-b border-zinc-800/40">
                      <td className="px-3 py-3 text-sm text-zinc-400">{formatTime(s.createdAt)}</td>
                      <td className="px-3 py-3 text-sm text-white">{formatLamports(s.grossLamports)}</td>
                      <td className="px-3 py-3 text-sm text-amber-400">{formatLamports(s.platformFeeLamports)}</td>
                      <td className="px-3 py-3 text-sm text-emerald-400">{formatLamports(s.netLamports)}</td>
                      <td className="px-3 py-3 text-sm">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          s.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                          s.status === "pending" ? "bg-amber-500/10 text-amber-400" :
                          "bg-red-500/10 text-red-400"
                        }`}>{s.status}</span>
                      </td>
                      <td className="px-3 py-3 text-sm">
                        {s.txSignature ? (
                          <a 
                            href={`https://solscan.io/tx/${s.txSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-400 hover:text-white transition-colors"
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
              <div className="mt-8">
                <h3 className="text-zinc-400 text-sm font-medium mb-3">Platform Revenue</h3>
                <div className="flex gap-6">
                  <div className="bg-zinc-950 rounded-xl p-5 text-center">
                    <div className="text-xl font-bold text-white">{formatLamports(platformRevenue.totalFeesLamports)}</div>
                    <div className="text-zinc-500 text-xs mt-1">Total Platform Fees</div>
                  </div>
                  <div className="bg-zinc-950 rounded-xl p-5 text-center">
                    <div className="text-xl font-bold text-white">{platformRevenue.settlementCount}</div>
                    <div className="text-zinc-500 text-xs mt-1">Total Settlements</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 6. DEPOSITS */}
        {activeTab === "deposits" && (
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-1">Deposit &amp; Withdraw SOL</h2>
            <p className="text-zinc-500 text-sm mb-6">Fund your agent account with real SOL or withdraw to your wallet</p>

            {/* Agent Selector */}
            <div className="mb-5">
              <label className="block mb-2 text-zinc-400 text-sm font-medium">Select Agent</label>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="w-full max-w-lg px-4 py-3 bg-zinc-950 border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                ))}
              </select>
            </div>

            {/* Current Balance */}
            {economicState && (
              <div className="flex justify-between items-center p-5 bg-zinc-950 border border-zinc-800/60 rounded-xl mb-6">
                <span className="text-zinc-500 text-sm">Current Balance</span>
                <span className="text-2xl font-bold text-white">{formatLamports(economicState.balanceLamports)}</span>
              </div>
            )}

            {/* Treasury Address */}
            {depositAddress && (
              <div className="bg-zinc-950 rounded-xl p-5 mb-6">
                <h3 className="text-white font-medium mb-4">Deposit SOL</h3>
                <div className="mb-6">
                  <label className="block mb-2 text-zinc-500 text-sm">Treasury Address ({depositAddress.network})</label>
                  <div className="flex gap-3 items-center bg-[#09090b] px-4 py-3 rounded-lg mb-2">
                    <code className="flex-1 font-mono text-sm text-zinc-400 break-all">{depositAddress.treasuryAddress}</code>
                    <button 
                      className="px-3 py-1.5 border border-zinc-800/60 rounded text-zinc-400 text-xs hover:text-white transition-colors"
                      onClick={() => {
                        navigator.clipboard.writeText(depositAddress.treasuryAddress);
                        showMessage("success", "Address copied!");
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <p className="text-xs text-zinc-600">{depositAddress.instructions}</p>
                </div>

                {/* Create Deposit Intent */}
                <div className="flex gap-4 items-end mb-4">
                  <div className="flex-1">
                    <label className="block mb-2 text-zinc-400 text-sm font-medium">Expected Amount (optional)</label>
                    <input
                      type="number"
                      placeholder="Amount in lamports"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="w-full px-4 py-3 bg-[#09090b] border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
                    />
                  </div>
                  <button 
                    className="px-6 py-3 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
                    onClick={handleCreateDepositIntent}
                    disabled={loading}
                  >
                    Create Deposit Intent
                  </button>
                </div>

                {/* Show Intent if created */}
                {depositIntent && (
                  <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-5 mt-4">
                    <h4 className="text-white font-medium mb-3">Deposit Intent Created</h4>
                    <div className="space-y-2 text-sm">
                      <p className="text-zinc-500"><strong className="text-zinc-400">Reference:</strong> {depositIntent.reference}</p>
                      <p className="text-zinc-500"><strong className="text-zinc-400">Expires:</strong> {formatTime(depositIntent.expiresAt)}</p>
                      {depositIntent.expectedAmountLamports && (
                        <p className="text-zinc-500"><strong className="text-zinc-400">Expected:</strong> {formatLamports(depositIntent.expectedAmountLamports)}</p>
                      )}
                    </div>
                    <div className="text-center my-5 inline-block p-4 bg-white rounded-lg">
                      <img src={depositIntent.qrCodeData} alt="Deposit QR Code" className="max-w-[200px]" />
                    </div>
                    <ol className="list-decimal pl-5 text-zinc-500 text-sm space-y-2">
                      {depositIntent.instructions.map((inst, i) => (
                        <li key={i}>{inst}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Verify Transaction */}
                <div className="mt-6 pt-6 border-t border-zinc-800/60">
                  <h4 className="text-zinc-400 text-sm font-medium mb-3">Verify a Transaction</h4>
                  <div className="flex gap-4 items-end">
                    <input
                      type="text"
                      placeholder="Solana transaction signature"
                      value={verifyTxSignature}
                      onChange={(e) => setVerifyTxSignature(e.target.value)}
                      className="flex-1 px-4 py-3 bg-[#09090b] border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
                    />
                    <button 
                      className="px-6 py-3 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
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
            <div className="bg-zinc-950 rounded-xl p-5 mb-6">
              <h3 className="text-white font-medium mb-4">Withdraw SOL</h3>
              <div className="mb-5">
                <label className="block mb-2 text-zinc-400 text-sm font-medium">Amount (lamports)</label>
                <input
                  type="number"
                  placeholder="Amount to withdraw"
                  value={withdrawForm.amount}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, amount: e.target.value })}
                  className="w-full px-4 py-3 bg-[#09090b] border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
                />
              </div>
              <div className="mb-5">
                <label className="block mb-2 text-zinc-400 text-sm font-medium">Destination Wallet Address</label>
                <input
                  type="text"
                  placeholder="Solana wallet address"
                  value={withdrawForm.toAddress}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, toAddress: e.target.value })}
                  className="w-full px-4 py-3 bg-[#09090b] border border-zinc-800/60 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
                />
              </div>
              <button 
                className="px-6 py-3 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
                onClick={handleWithdraw}
                disabled={loading || !withdrawForm.amount || !withdrawForm.toAddress}
              >
                Withdraw SOL
              </button>
            </div>

            {/* Pending Intents */}
            {pendingIntents.length > 0 && (
              <div className="mt-8">
                <h3 className="text-zinc-400 text-sm font-medium mb-3">Pending Deposit Intents</h3>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-800/60">
                      <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Reference</th>
                      <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Expected Amount</th>
                      <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Expires</th>
                      <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingIntents.map((pi, i) => (
                      <tr key={i} className="border-b border-zinc-800/40">
                        <td className="px-3 py-3 text-sm"><code className="text-zinc-400">{pi.reference}</code></td>
                        <td className="px-3 py-3 text-sm text-white">{pi.expectedAmountLamports ? formatLamports(pi.expectedAmountLamports) : "-"}</td>
                        <td className="px-3 py-3 text-sm text-zinc-400">{formatTime(pi.expiresAt)}</td>
                        <td className="px-3 py-3 text-sm">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            pi.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                            pi.status === "pending" ? "bg-amber-500/10 text-amber-400" :
                            "bg-red-500/10 text-red-400"
                          }`}>{pi.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Deposit History */}
            <div className="mt-8">
              <h3 className="text-zinc-400 text-sm font-medium mb-3">Deposit History</h3>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800/60">
                    <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Date</th>
                    <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Amount</th>
                    <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">Status</th>
                    <th className="text-left px-3 py-2 text-zinc-500 text-xs font-medium">TX Signature</th>
                  </tr>
                </thead>
                <tbody>
                  {depositHistory.length === 0 && (
                    <tr><td colSpan={4} className="text-center text-zinc-600 py-8 text-sm">No deposits yet</td></tr>
                  )}
                  {depositHistory.map((d, i) => (
                    <tr key={i} className="border-b border-zinc-800/40">
                      <td className="px-3 py-3 text-sm text-zinc-400">{formatTime(d.createdAt)}</td>
                      <td className="px-3 py-3 text-sm text-emerald-400">{formatLamports(d.amountLamports)}</td>
                      <td className="px-3 py-3 text-sm">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          d.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                          d.status === "pending" ? "bg-amber-500/10 text-amber-400" :
                          "bg-red-500/10 text-red-400"
                        }`}>{d.status}</span>
                      </td>
                      <td className="px-3 py-3 text-sm">
                        <a 
                          href={`https://solscan.io/tx/${d.txSignature}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-400 hover:text-white transition-colors"
                        >
                          {d.txSignature.slice(0, 12)}...
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
