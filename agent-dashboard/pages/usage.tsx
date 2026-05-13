import Link from "next/link";
import { useEffect, useState } from "react";
import Layout from "../components/Layout";

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/proxy";

interface UsageRow { agent_id: string; calls: number | string; total_tokens?: number | string; total_cost_lamports?: number | string }
interface EarningsRow { agent_id?: string; total_received_lamports?: number | string; settlement_count?: number | string }

const lamportsToSol = (n: number) => (n / 1_000_000_000).toFixed(6);
const fmtLamports = (n: number) => n.toLocaleString();

export default function Usage() {
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [earnings, setEarnings] = useState<EarningsRow[]>([]);
  const [platformFeeLamports, setPlatformFeeLamports] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [usageRes, earningsRes, feesRes] = await Promise.all([
          fetch(`${API_URL}/dashboard/usage`).then((r) => r.json()),
          fetch(`${API_URL}/dashboard/earnings/by-agent`).then((r) => r.json()),
          fetch(`${API_URL}/dashboard/earnings`).then((r) => r.json()),
        ]);
        setUsage(Array.isArray(usageRes) ? usageRes : []);
        setEarnings(Array.isArray(earningsRes) ? earningsRes : []);
        setPlatformFeeLamports(Number(feesRes?.total_fees_lamports) || 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
  }, []);

  const totalCalls = usage.reduce((a, r) => a + Number(r.calls || 0), 0);
  const totalVolumeLamports = usage.reduce((a, r) => a + Number(r.total_cost_lamports || 0), 0);
  const totalSettlementsLamports = earnings.reduce((a, r) => a + Number(r.total_received_lamports || 0), 0);

  return (
    <Layout title="Usage">
      {/* Hero stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">Monocle revenue</div>
          <div className="text-2xl font-bold text-white">{lamportsToSol(platformFeeLamports)} <span className="text-sm font-normal text-zinc-500">SOL</span></div>
          <div className="text-[11px] font-mono text-zinc-500 mt-1">{fmtLamports(platformFeeLamports)} lamports · 5% fee</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">Platform volume</div>
          <div className="text-2xl font-bold text-white">{lamportsToSol(totalVolumeLamports)} <span className="text-sm font-normal text-zinc-500">SOL</span></div>
          <div className="text-[11px] font-mono text-zinc-500 mt-1">{fmtLamports(totalVolumeLamports)} lamports gross</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">Settled (net)</div>
          <div className="text-2xl font-bold text-white">{lamportsToSol(totalSettlementsLamports)} <span className="text-sm font-normal text-zinc-500">SOL</span></div>
          <div className="text-[11px] font-mono text-zinc-500 mt-1">paid out to agents</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">Total tool calls</div>
          <div className="text-2xl font-bold text-white">{totalCalls.toLocaleString()}</div>
          <div className="text-[11px] font-mono text-zinc-500 mt-1">across {usage.length} agents</div>
        </div>
      </div>

      {/* Fire a call CTA */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-5 mb-8 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-[280px]">
          <h3 className="text-sm font-semibold text-white mb-1">Want to grow these numbers?</h3>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Run a real meter/execute call between any two registered agents — the numbers above update immediately.
          </p>
        </div>
        <Link href="/test-call" className="px-5 py-2.5 rounded-xl bg-white text-zinc-900 font-semibold text-sm hover:bg-zinc-200 transition-colors whitespace-nowrap">
          Run a test call →
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300 mb-6">{error}</div>
      )}

      {/* Spend by callee */}
      <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl mb-8 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <div>
            <h2 className="text-[15px] font-semibold text-white">Tool calls by callee</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">Who got called and how much was spent on them (gross, before fee)</p>
          </div>
          <Link href="/receipts" className="text-sm text-zinc-500 hover:text-white transition-colors">View receipts →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800/60">
                <th className="text-left px-6 py-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">Agent</th>
                <th className="text-left px-6 py-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">Calls</th>
                <th className="text-left px-6 py-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">Tokens</th>
                <th className="text-left px-6 py-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">Gross (lamports)</th>
                <th className="text-left px-6 py-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">Gross (SOL)</th>
              </tr>
            </thead>
            <tbody>
              {usage.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-600">
                    No calls yet. <Link href="/test-call" className="text-zinc-400 underline hover:text-white">Fire one</Link>.
                  </td>
                </tr>
              ) : (
                usage.map((r) => (
                  <tr key={String(r.agent_id)} className="border-b border-zinc-800/40 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-3 text-sm font-mono">
                      <Link href={`/agents/${encodeURIComponent(String(r.agent_id))}`} className="text-white hover:underline">
                        {String(r.agent_id)}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-sm text-zinc-300 font-mono">{r.calls}</td>
                    <td className="px-6 py-3 text-sm text-zinc-300 font-mono">{Number(r.total_tokens || 0).toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm text-zinc-300 font-mono">{Number(r.total_cost_lamports || 0).toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400 font-mono">{lamportsToSol(Number(r.total_cost_lamports || 0))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Earnings by agent (settled, net of fee) */}
      <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl mb-8 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <div>
            <h3 className="text-[15px] font-semibold text-white">Settled earnings by agent</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">What agents actually received on-chain after Monocle's 5% fee</p>
          </div>
          <span className="text-xs text-zinc-600">Top 50</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800/60">
                <th className="text-left px-6 py-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">Agent</th>
                <th className="text-left px-6 py-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">Net received (lamports)</th>
                <th className="text-left px-6 py-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">Net (SOL)</th>
                <th className="text-left px-6 py-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">Settlements</th>
              </tr>
            </thead>
            <tbody>
              {earnings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-zinc-600">
                    No settlements yet. They run every 5 min once pending balances exceed 10,000 lamports.
                  </td>
                </tr>
              ) : (
                earnings.map((r, idx) => (
                  <tr key={idx} className="border-b border-zinc-800/40 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-3 text-sm font-mono">
                      <Link href={`/agents/${encodeURIComponent(String(r.agent_id || ""))}`} className="text-white hover:underline">
                        {String(r.agent_id ?? "")}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-sm text-zinc-300 font-mono">{Number(r.total_received_lamports || 0).toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400 font-mono">{lamportsToSol(Number(r.total_received_lamports || 0))}</td>
                    <td className="px-6 py-3 text-sm text-zinc-300 font-mono">{r.settlement_count ?? 0}</td>
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
