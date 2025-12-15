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
        <div className="brand">AgentPay Dashboard</div>
        <div className="links">
          <Link href="/usage">Usage</Link>
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

      <style jsx>{`
        .page {
          max-width: 1080px;
          margin: 0 auto;
          padding: 24px;
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: #f7f8fa;
          min-height: 100vh;
        }
        .nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
        }
        .brand {
          font-weight: 700;
          font-size: 20px;
        }
        .links a {
          margin-left: 16px;
          color: #2563eb;
          text-decoration: none;
          font-weight: 600;
        }
        .card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 20px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        h2,
        h3 {
          margin: 0;
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 12px;
        }
        .stat {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 12px;
        }
        .label {
          font-size: 12px;
          color: #6b7280;
          margin-bottom: 6px;
        }
        .value {
          font-size: 20px;
          font-weight: 700;
        }
        .hint {
          color: #6b7280;
          font-size: 12px;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
        }
        .table th,
        .table td {
          text-align: left;
          padding: 10px 12px;
          border-bottom: 1px solid #e5e7eb;
          font-size: 14px;
        }
        .table th {
          background: #f3f4f6;
          font-weight: 600;
        }
        .table tr:hover td {
          background: #f9fafb;
        }
        .empty {
          text-align: center;
          color: #6b7280;
          padding: 16px;
        }
        .link-button {
          padding: 8px 12px;
          background: #2563eb;
          color: white;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 600;
        }
        .link-button:hover {
          background: #1d4ed8;
        }
      `}</style>
    </main>
  );
}

