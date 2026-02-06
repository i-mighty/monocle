import Link from "next/link";
import { useEffect, useState } from "react";
import { getReceipts } from "../lib/api";

type ReceiptRow = { id?: string; sender: string; receiver: string; amount: number; tx_signature: string; timestamp?: string };

export default function Receipts() {
  const [rows, setRows] = useState<ReceiptRow[]>([]);

  useEffect(() => {
    getReceipts().then(setRows).catch(console.error);
  }, []);

  return (
    <main className="page">
      <header className="nav">
        <div className="brand">AgentPay Dashboard</div>
        <div className="links">
          <Link href="/usage">Usage</Link>
          <Link href="/receipts">Receipts</Link>
          <Link href="/messaging">Messaging</Link>
        </div>
      </header>

      <section className="card">
        <div className="card-header">
          <h2>Micropayment Receipts</h2>
          <span className="hint">Latest 100</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Sender</th>
              <th>Receiver</th>
              <th>Amount (SOL)</th>
              <th>Tx Signature</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  No receipts yet. Trigger a payment to see entries here.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.id ?? idx}>
                  <td>{r.sender}</td>
                  <td>{r.receiver}</td>
                  <td>{r.amount}</td>
                  <td className="tx">{r.tx_signature}</td>
                  <td>{r.timestamp ? new Date(r.timestamp).toLocaleString() : "—"}</td>
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
        h2 {
          margin: 0;
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
        .tx {
          max-width: 220px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
          font-size: 12px;
        }
      `}</style>
    </main>
  );
}

