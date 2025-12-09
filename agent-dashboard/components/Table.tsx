import { ReactNode } from "react";

type Props = { headers: ReactNode[]; rows: ReactNode[][] };

export function Table({ headers, rows }: Props) {
  return (
    <table>
      <thead>
        <tr>{headers.map((h, i) => (<th key={i}>{h}</th>))}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => (<td key={j}>{c}</td>))}</tr>
        ))}
      </tbody>
    </table>
  );
}

