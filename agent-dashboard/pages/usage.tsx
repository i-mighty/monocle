import { useEffect, useState } from "react";
import { getUsage } from "../lib/api";

export default function Usage() {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    getUsage().then(setRows).catch(console.error);
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h2>Usage</h2>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Calls</th>
            <th>Spend (SOL est)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agent_id}>
              <td>{r.agent_id}</td>
              <td>{r.calls}</td>
              <td>{Number(r.spend).toFixed(6)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

