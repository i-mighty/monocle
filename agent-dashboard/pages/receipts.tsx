import { useEffect, useState } from "react";
import { getReceipts } from "../lib/api";

export default function Receipts() {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    getReceipts().then(setRows).catch(console.error);
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h2>Micropayment Receipts</h2>
      <table>
        <thead>
          <tr>
            <th>Sender</th>
            <th>Receiver</th>
            <th>Amount</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.sender}</td>
              <td>{r.receiver}</td>
              <td>{r.amount}</td>
              <td>{r.tx_signature}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

