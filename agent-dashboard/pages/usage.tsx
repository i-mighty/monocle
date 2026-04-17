import Link from "next/link";
import { useEffect, useState } from "react";
import { getUsage, getToolLogs, getEarnings, getEarningsByAgent } from "../lib/api";
import Layout from "../components/Layout";

type UsageRow = { agent_id: string; calls: number; spend: number };
type LogRow = { agent_id: string; tool_name: string; tokens_used: number; timestamp: string };
type EarningsRow = { receiver: string; total_sol: string | number; payments: number };

export default function Usage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [totalEarned, setTotalEarned] = useState<number>(0);
  const [earningsByAgent, setEarningsByAgent] = useState<EarningsRow[]>([]);

  useEffect(() => {
    getUsage().then(setRows).catch(console.error);
    getToolLogs().then(setLogs).catch(console.error);
    getEarnings()
      .then((r) => setTotalEarned(Number(r.total_sol || 0)))
      .catch(console.error);
    getEarningsByAgent()
      .then((r) => setEarningsByAgent(r || []))
      .catch(console.error);
  }, []);

  return (
    <Layout title="Usage">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Total Earned (SOL)</div>
          <div className="text-2xl font-bold text-white">{totalEarned.toFixed(6)}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Total Calls</div>
          <div className="text-2xl font-bold text-white">
            {rows.reduce((acc, r) => acc + Number(r.calls || 0), 0)}
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Agents</div>
          <div className="text-2xl font-bold text-white">{rows.length}</div>
        </div>
      </div>

      {/* Usage by Agent */}
      <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl mb-8 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <h2 className="text-[17px] font-semibold text-white">Usage by Agent</h2>
          <Link href="/receipts" className="text-sm text-zinc-400 hover:text-white transition-colors">
            View Receipts →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800/60">
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Agent</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Calls</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Spend (SOL est)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-zinc-600">
                    No usage yet. Trigger a tool call to see data.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.agent_id} className="border-b border-zinc-800/40 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-3 text-sm text-white font-mono">{r.agent_id}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400">{r.calls}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400">{Number(r.spend).toFixed(6)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Earnings by Agent */}
      <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl mb-8 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <h3 className="text-[17px] font-semibold text-white">Earnings by Agent</h3>
          <span className="text-xs text-zinc-600">Top 50</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800/60">
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Receiver</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Total SOL</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Payments</th>
              </tr>
            </thead>
            <tbody>
              {earningsByAgent.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-zinc-600">
                    No receipts yet. Trigger a payment to see earnings.
                  </td>
                </tr>
              ) : (
                earningsByAgent.map((r, idx) => (
                  <tr key={idx} className="border-b border-zinc-800/40 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-3 text-sm text-white font-mono">{r.receiver}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400">{Number(r.total_sol).toFixed(6)}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400">{r.payments}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent Tool Logs */}
      <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <h3 className="text-[17px] font-semibold text-white">Recent Tool Logs</h3>
          <span className="text-xs text-zinc-600">Latest 100 entries</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800/60">
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Agent</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Tool</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Tokens</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-zinc-600">
                    No logs yet. Make a call to populate this table.
                  </td>
                </tr>
              ) : (
                logs.map((l, idx) => (
                  <tr key={idx} className="border-b border-zinc-800/40 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-3 text-sm text-white font-mono">{l.agent_id}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400">{l.tool_name}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400">{l.tokens_used}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400">{new Date(l.timestamp).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </Layout>
  );
}
