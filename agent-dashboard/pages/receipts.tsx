import Link from "next/link";
import { useEffect, useState } from "react";
import { getReceipts } from "../lib/api";
import Layout from "../components/Layout";

type ReceiptRow = { id?: string; sender: string; receiver: string; amount: number; tx_signature: string; timestamp?: string };

export default function Receipts() {
  const [rows, setRows] = useState<ReceiptRow[]>([]);

  useEffect(() => {
    getReceipts().then(setRows).catch(console.error);
  }, []);

  return (
    <Layout title="Receipts">
      <section className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <h2 className="text-[17px] font-semibold text-white">Micropayment Receipts</h2>
          <span className="text-xs text-zinc-600">Latest 100</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800/60">
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Sender</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Receiver</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Amount (SOL)</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Tx Signature</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-500 uppercase tracking-wider font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-600">
                    No receipts yet. Trigger a payment to see entries here.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.id ?? idx} className="border-b border-zinc-800/40 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-3 text-sm text-white font-mono">{r.sender}</td>
                    <td className="px-6 py-3 text-sm text-white font-mono">{r.receiver}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400">{r.amount}</td>
                    <td className="px-6 py-3 text-sm text-zinc-500 font-mono max-w-[220px] truncate">{r.tx_signature}</td>
                    <td className="px-6 py-3 text-sm text-zinc-400">{r.timestamp ? new Date(r.timestamp).toLocaleString() : "—"}</td>
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

