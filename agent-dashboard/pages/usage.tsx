import { useEffect, useState } from "react";
import { getUsage, getToolLogs } from "../lib/api";

export default function Usage() {
  const [rows, setRows] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    getUsage().then(setRows).catch(console.error);
    getToolLogs().then(setLogs).catch(console.error);
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

      <h3 style={{ marginTop: 24 }}>Recent Tool Logs</h3>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Tool</th>
            <th>Tokens</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l, idx) => (
            <tr key={idx}>
              <td>{l.agent_id}</td>
              <td>{l.tool_name}</td>
              <td>{l.tokens_used}</td>
              <td>{new Date(l.timestamp).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

