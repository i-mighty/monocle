import Link from "next/link";
import { useEffect, useState } from "react";
import { getUsage, getToolLogs, getEarnings, getEarningsByAgent } from "../lib/api";

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
    <main className="page">
      <header className="nav">
        <div className="brand">AgentPay Marketplace</div>
        <div className="links">
          <Link href="/">Marketplace</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/usage" className="active">Usage</Link>
          <Link href="/receipts">Receipts</Link>
        </div>
      </header>

      <section className="card">
        <div className="card-header">
          <h2>Usage Summary</h2>
          <Link href="/receipts" className="link-button">
            View Receipts
          </Link>
        </div>
        <div className="stats">
          <div className="stat">
            <div className="label">Total Earned (SOL)</div>
            <div className="value">{totalEarned.toFixed(6)}</div>
          </div>
          <div className="stat">
            <div className="label">Total Calls</div>
            <div className="value">
              {rows.reduce((acc, r) => acc + Number(r.calls || 0), 0)}
            </div>
          </div>
          <div className="stat">
            <div className="label">Agents</div>
            <div className="value">{rows.length}</div>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Calls</th>
              <th>Spend (SOL est)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty">
                  No usage yet. Trigger a tool call to see data.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.agent_id}>
                  <td>{r.agent_id}</td>
                  <td>{r.calls}</td>
                  <td>{Number(r.spend).toFixed(6)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-header">
          <h3>Earnings by Agent (receiver)</h3>
          <span className="hint">Top 50</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Receiver</th>
              <th>Total SOL</th>
              <th>Payments</th>
            </tr>
          </thead>
          <tbody>
            {earningsByAgent.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty">
                  No receipts yet. Trigger a payment to see earnings.
                </td>
              </tr>
            ) : (
              earningsByAgent.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.receiver}</td>
                  <td>{Number(r.total_sol).toFixed(6)}</td>
                  <td>{r.payments}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-header">
          <h3>Recent Tool Logs</h3>
          <span className="hint">Latest 100 entries</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Tool</th>
              <th>Tokens</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  No logs yet. Make a call to populate this table.
                </td>
              </tr>
            ) : (
              logs.map((l, idx) => (
                <tr key={idx}>
                  <td>{l.agent_id}</td>
                  <td>{l.tool_name}</td>
                  <td>{l.tokens_used}</td>
                  <td>{new Date(l.timestamp).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <style jsx global>{`
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
        .links a:hover, .links a.active {
          background: rgba(139, 92, 246, 0.2);
          color: #c4b5fd;
        }
        .card {
          background: rgba(30, 27, 75, 0.6);
          border-radius: 16px;
          padding: 24px;
          margin-bottom: 24px;
          border: 1px solid rgba(139, 92, 246, 0.2);
        }
        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(139, 92, 246, 0.1);
        }
        h2, h3 { margin: 0; color: #f1f5f9; font-weight: 600; }
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }
        .stat {
          background: rgba(15, 23, 42, 0.6);
          border-radius: 12px;
          padding: 16px;
        }
        .label {
          font-size: 12px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        .value {
          font-size: 28px;
          font-weight: 700;
          color: #c4b5fd;
        }
        .hint {
          color: #64748b;
          font-size: 12px;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
        }
        .table th, .table td {
          text-align: left;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(139, 92, 246, 0.1);
          font-size: 14px;
        }
        .table th {
          background: rgba(15, 23, 42, 0.6);
          font-weight: 600;
          color: #c4b5fd;
        }
        .table td {
          color: #e2e8f0;
        }
        .table tr:hover td {
          background: rgba(139, 92, 246, 0.05);
        }
        .empty {
          text-align: center;
          color: #64748b;
          padding: 24px;
        }
        .link-button {
          padding: 10px 16px;
          background: linear-gradient(135deg, #8b5cf6, #6366f1);
          color: white;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 600;
          font-size: 14px;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .link-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(139, 92, 246, 0.4);
        }
      `}</style>
    </main>
  );
}
