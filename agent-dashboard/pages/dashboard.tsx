import Link from "next/link";
import { useEffect, useState } from "react";
import { getUsage, getEarnings, getToolLogs, getDeployedAgents, DeployedAgent } from "../lib/api";
import { searchAgents, AgentSearchResult } from "../lib/reputation-api";
import Layout from "../components/Layout";

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
    <Layout title="Dashboard">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white tracking-tight">Dashboard</h1>
        <p className="text-zinc-500 mt-1">Manage your deployed agents and monitor usage</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Deployed Agents", value: deployedAgents.length },
          { label: "Total Calls", value: totalCalls.toLocaleString() },
          { label: "Total Spend", value: `${totalSpend.toFixed(4)} SOL` },
          { label: "Total Earned", value: `${totalEarned.toFixed(4)} SOL` },
        ].map((s) => (
          <div key={s.label} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-5">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">{s.label}</div>
            <div className="text-2xl font-bold text-white">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deployed Agents - full width */}
        <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800/60">
            <h2 className="text-[15px] font-semibold text-white">Deployed Agents</h2>
            <Link href="/" className="text-xs bg-white text-zinc-900 font-medium px-3 py-1.5 rounded-lg hover:bg-zinc-200 transition-colors">+ Deploy New</Link>
          </div>
          <div className="space-y-3">
            {authError && (
              <div className="text-center py-6 text-zinc-500">
                <p className="mb-3">{authError}</p>
                <Link href="/login" className="bg-white text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-zinc-200 transition-colors">Log In</Link>
              </div>
            )}
            {!authError && deployedAgents.map((agent) => (
              <div key={agent.id} className="flex items-center gap-4 p-4 bg-zinc-800/30 rounded-xl">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700/50 flex items-center justify-center text-white font-bold">
                  {agent.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white text-sm">{agent.name}</div>
                  <div className="text-xs text-zinc-500 flex gap-3">
                    <span>{agent.calls} calls</span>
                    <span>{agent.spend.toFixed(4)} SOL spent</span>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${agent.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}>
                  {agent.status}
                </span>
                <div className="flex gap-2">
                  <Link href={`/agents/${agent.slug}`} className="text-xs text-zinc-400 hover:text-white px-2 py-1 bg-zinc-800 rounded transition-colors">View</Link>
                  <Link href={`/review/${agent.slug}`} className="text-xs text-zinc-400 hover:text-white px-2 py-1 bg-zinc-800 rounded transition-colors">Review</Link>
                </div>
              </div>
            ))}
            {!authError && deployedAgents.length === 0 && (
              <div className="text-center py-8 text-zinc-600">
                <p className="mb-3">No agents deployed yet</p>
                <Link href="/" className="text-zinc-400 hover:text-white text-sm underline">Browse Marketplace</Link>
              </div>
            )}
          </div>
        </section>

        {/* Recent Activity */}
        <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800/60">
            <h2 className="text-[15px] font-semibold text-white">Recent Activity</h2>
            <Link href="/usage" className="text-xs text-zinc-500 hover:text-white transition-colors">View All</Link>
          </div>
          <div className="space-y-2">
            {recentLogs.length > 0 ? (
              recentLogs.map((log, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 bg-zinc-800/30 rounded-lg">
                  <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-zinc-400 text-xs font-mono">fn</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white">{log.tool_name}</div>
                    <div className="text-xs text-zinc-600">{log.agent_id} · {log.tokens_used} tokens</div>
                  </div>
                  <div className="text-xs text-zinc-600">{new Date(log.timestamp).toLocaleTimeString()}</div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-zinc-600 text-sm">No recent activity</div>
            )}
          </div>
        </section>

        {/* Recommended Agents */}
        <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800/60">
            <h2 className="text-[15px] font-semibold text-white">Recommended Agents</h2>
            <Link href="/" className="text-xs text-zinc-500 hover:text-white transition-colors">View All</Link>
          </div>
          <div className="space-y-2">
            {marketplaceAgents.filter(item => item.agent).map(({ agent, trustScore }) => (
              <Link key={agent.id} href={`/agents/${agent.slug}`} className="flex items-center gap-3 p-3 bg-zinc-800/30 rounded-lg hover:bg-zinc-800/50 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700/50 flex items-center justify-center text-white font-bold text-sm">
                  {agent.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="text-sm text-white">{agent.name}</div>
                  <div className="text-xs text-emerald-400">Trust: {trustScore?.overallScore.toFixed(0) || 'N/A'}</div>
                </div>
                <span className="text-zinc-600">→</span>
              </Link>
            ))}
            {marketplaceAgents.filter(item => item.agent).length === 0 && !loading && (
              <div className="text-center py-6 text-zinc-600 text-sm">Start the reputation API to see recommendations</div>
            )}
          </div>
        </section>

        {/* Quick Actions */}
        <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6 lg:col-span-2">
          <div className="mb-4 pb-3 border-b border-zinc-800/60">
            <h2 className="text-[15px] font-semibold text-white">Quick Actions</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { href: "/", label: "Browse Agents", icon: "Search" },
              { href: "/usage", label: "View Usage", icon: "Stats" },
              { href: "/receipts", label: "Receipts", icon: "Pay" },
              { href: "/analytics", label: "Analytics", icon: "Charts" },
            ].map((action) => (
              <Link key={action.href} href={action.href} className="flex flex-col items-center gap-2 p-4 bg-zinc-800/30 rounded-xl hover:bg-zinc-800/60 transition-colors">
                <span className="text-xs font-medium text-zinc-400 uppercase">{action.icon}</span>
                <span className="text-xs text-zinc-500">{action.label}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}
