import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import {
  ArenaOverview,
  ArenaPosition,
  ArenaSettlement,
  ArenaSignal,
  MatchSnapshot,
  SelectionKey,
  StrategyId,
  getArenaMatches,
  getArenaOverview,
  getArenaPositions,
  getArenaSettlements,
  getArenaSignals,
  explorerTx,
  fmtSol,
  pct,
} from "../lib/arena-api";

const POLL_MS = 3000;

const STRAT_COLOR: Record<StrategyId, string> = {
  "sharp-follower": "text-sky-400",
  "contrarian-value": "text-amber-400",
};
const STRAT_BG: Record<StrategyId, string> = {
  "sharp-follower": "bg-sky-500/10 border-sky-500/30",
  "contrarian-value": "bg-amber-500/10 border-amber-500/30",
};
const SEL_COLOR: Record<SelectionKey, string> = {
  HOME: "bg-emerald-500",
  DRAW: "bg-zinc-500",
  AWAY: "bg-violet-500",
};

function pnlColor(n: number): string {
  return n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-zinc-400";
}

export default function ArenaPage() {
  const [overview, setOverview] = useState<ArenaOverview | null>(null);
  const [matches, setMatches] = useState<MatchSnapshot[]>([]);
  const [signals, setSignals] = useState<ArenaSignal[]>([]);
  const [positions, setPositions] = useState<ArenaPosition[]>([]);
  const [settlements, setSettlements] = useState<ArenaSettlement[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [ov, ms, sg, ps, st] = await Promise.all([
          getArenaOverview(),
          getArenaMatches(),
          getArenaSignals(30),
          getArenaPositions(),
          getArenaSettlements(30),
        ]);
        if (!alive) return;
        setOverview(ov);
        setMatches(ms);
        setSignals(sg);
        setPositions(ps);
        setSettlements(st);
        setError(null);
      } catch (e: any) {
        if (alive) setError(e?.message ?? "failed to reach Arena backend");
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const matchById = useMemo(() => {
    const m = new Map<number, MatchSnapshot>();
    for (const x of matches) m.set(x.fixtureId, x);
    return m;
  }, [matches]);

  const teamLabel = (fixtureId: number) => {
    const m = matchById.get(fixtureId);
    return m ? `${m.home} v ${m.away}` : `#${fixtureId}`;
  };

  return (
    <Layout title="Agent Arena — TxLINE World Cup">
      {error && (
        <div className="mb-6 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}. Is the backend running with the Arena enabled?
        </div>
      )}

      {/* Status strip */}
      {overview && <StatusStrip overview={overview} />}

      {/* Scoreboard */}
      {overview && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {overview.agents.map((a) => (
            <AgentCard key={a.id} a={a} isLeader={overview.leader === a.id} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Matches */}
        <section className="lg:col-span-2">
          <SectionTitle>Live consensus — TxLINE 1×2 (vig-free)</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {matches.length === 0 && <Empty>Waiting for first feed tick…</Empty>}
            {matches.map((m) => (
              <MatchCard key={m.fixtureId} m={m} />
            ))}
          </div>
        </section>

        {/* Signal feed */}
        <section>
          <SectionTitle>Strategy signals</SectionTitle>
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {signals.length === 0 && <Empty>No signals yet.</Empty>}
            {signals.map((s) => (
              <SignalRow key={s.id} s={s} label={teamLabel(s.fixtureId)} />
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        {/* Positions */}
        <section>
          <SectionTitle>Positions</SectionTitle>
          <PositionsTable positions={positions} teamLabel={teamLabel} />
        </section>

        {/* Settlements */}
        <section>
          <SectionTitle>On-chain settlements</SectionTitle>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {settlements.length === 0 && <Empty>No settlements yet — they fire when a match resolves.</Empty>}
            {settlements.map((s) => (
              <SettlementRow key={s.id} s={s} label={teamLabel(s.fixtureId)} />
            ))}
          </div>
        </section>
      </div>

      <p className="mt-10 text-xs text-zinc-600">
        Data: TxLINE World Cup consensus feed (1×2, vig-free <code>Pct</code>). Positions are priced as
        prediction-market shares and settled on Solana devnet via Monocle&apos;s settlement rail.
      </p>
    </Layout>
  );
}

function StatusStrip({ overview }: { overview: ArenaOverview }) {
  const ageS = overview.lastTickAt ? Math.round((Date.now() - overview.lastTickAt) / 1000) : null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
      <span
        className={`px-2 py-0.5 rounded-md font-medium ${
          overview.mode === "live" ? "bg-emerald-500/15 text-emerald-400" : "bg-sky-500/15 text-sky-400"
        }`}
      >
        {overview.mode === "live" ? "● LIVE TxLINE" : "◆ SIM"}
      </span>
      <span className="text-zinc-500">
        tick <span className="text-zinc-300">#{overview.tickCount}</span>
        {ageS != null && <span className="text-zinc-600"> · {ageS}s ago</span>}
      </span>
      <span className="text-zinc-500">
        stake <span className="text-zinc-300">{fmtSol(overview.stakeLamports).replace("+", "")}</span>/signal
      </span>
      <span className="text-zinc-500">
        open <span className="text-zinc-300">{overview.openPositions}</span>
      </span>
      <span className="text-zinc-500">
        threshold <span className="text-zinc-300">{(overview.config.moveThreshold * 100).toFixed(1)}pp</span> /{" "}
        {overview.config.lookback} ticks
      </span>
      {overview.lastError && <span className="text-rose-400">feed: {overview.lastError}</span>}
    </div>
  );
}

function AgentCard({ a, isLeader }: { a: ArenaOverview["agents"][number]; isLeader: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${STRAT_BG[a.strategy]} ${isLeader ? "ring-1 ring-white/20" : ""}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-white">{a.name}</h3>
            {isLeader && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-white">🏆 leading</span>
            )}
          </div>
          <div className={`text-xs font-mono ${STRAT_COLOR[a.strategy]}`}>{a.solName}</div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold tabular-nums ${pnlColor(a.netPnlLamports)}`}>
            {fmtSol(a.netPnlLamports)}
          </div>
          <div className="text-xs text-zinc-500">net P&amp;L</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="realized" value={fmtSol(a.realizedPnlLamports)} color={pnlColor(a.realizedPnlLamports)} />
        <Stat
          label="unrealized"
          value={fmtSol(a.unrealizedPnlLamports)}
          color={pnlColor(a.unrealizedPnlLamports)}
        />
        <Stat label="win rate" value={a.positionsSettled ? pct(a.winRate) : "—"} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>
          {a.wins}W / {a.losses}L · {a.positionsOpen} open
        </span>
        <span className="font-mono">{a.walletPubkey.slice(0, 4)}…{a.walletPubkey.slice(-4)}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-black/20 py-2">
      <div className={`text-sm font-semibold tabular-nums ${color ?? "text-zinc-200"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

function MatchCard({ m }: { m: MatchSnapshot }) {
  const live = m.status === "live";
  const finished = m.status === "finished";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-zinc-200">
          {m.home} <span className="text-zinc-600">v</span> {m.away}
        </span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            live
              ? "bg-emerald-500/15 text-emerald-400"
              : finished
              ? "bg-zinc-700/40 text-zinc-400"
              : "bg-zinc-800 text-zinc-500"
          }`}
        >
          {live && m.score ? `${m.score.minute}'` : m.status.toUpperCase()}
        </span>
      </div>
      <div className="mt-1 text-xs text-zinc-500">
        {m.score ? (
          <span className="text-zinc-300 font-semibold">
            {m.score.home} – {m.score.away}
          </span>
        ) : (
          "kick-off pending"
        )}
        <span className="text-zinc-600"> · {m.competition}</span>
      </div>

      {m.market ? (
        <>
          <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full">
            {m.market.selections.map((s) => (
              <div key={s.key} className={SEL_COLOR[s.key]} style={{ width: `${s.prob * 100}%` }} />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] tabular-nums">
            {m.market.selections.map((s) => (
              <span key={s.key} className="text-zinc-400">
                <span className="text-zinc-500">{s.key[0]}</span> {pct(s.prob)}{" "}
                <span className="text-zinc-600">@{s.decimalOdds.toFixed(2)}</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-3 text-[11px] text-zinc-600">no consensus market yet</div>
      )}
    </div>
  );
}

function SignalRow({ s, label }: { s: ArenaSignal; label: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span className={`font-medium ${STRAT_COLOR[s.strategy]}`}>{s.strategy}</span>
        <span className={s.move > 0 ? "text-emerald-400" : "text-rose-400"}>
          {s.move > 0 ? "▲" : "▼"} {(Math.abs(s.move) * 100).toFixed(1)}pp
        </span>
      </div>
      <div className="mt-0.5 text-zinc-400">
        {label} · <span className="text-zinc-200">{s.selection}</span> @ {pct(s.entryProb)}
        {!s.acted && <span className="ml-1 text-zinc-600">(skipped — already in)</span>}
      </div>
    </div>
  );
}

function PositionsTable({
  positions,
  teamLabel,
}: {
  positions: ArenaPosition[];
  teamLabel: (id: number) => string;
}) {
  if (positions.length === 0) return <Empty>No positions yet.</Empty>;
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-xs">
        <thead className="bg-zinc-900/60 text-zinc-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Match</th>
            <th className="px-2 py-2 text-left font-medium">Strat</th>
            <th className="px-2 py-2 text-center font-medium">Sel</th>
            <th className="px-2 py-2 text-right font-medium">Entry</th>
            <th className="px-2 py-2 text-right font-medium">Mark</th>
            <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {positions.slice(0, 40).map((p) => {
            const pnl = p.status === "open" ? p.unrealizedPnlLamports : p.realizedPnlLamports;
            return (
              <tr key={p.id} className="border-t border-zinc-800/60">
                <td className="px-3 py-1.5 text-zinc-300">{teamLabel(p.fixtureId)}</td>
                <td className={`px-2 py-1.5 ${STRAT_COLOR[p.strategy]}`}>{p.strategy.split("-")[0]}</td>
                <td className="px-2 py-1.5 text-center text-zinc-300">{p.selection}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{pct(p.entryProb)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">
                  {p.status === "settled" ? (p.won ? "WON" : "LOST") : pct(p.markProb)}
                </td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${pnlColor(pnl)}`}>{fmtSol(pnl)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SettlementRow({ s, label }: { s: ArenaSettlement; label: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300">{label}</span>
        <span className={`tabular-nums ${pnlColor(s.netPnlLamports)}`}>{fmtSol(s.netPnlLamports)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-zinc-500">
          {s.agentId.replace("arena-", "")} · {s.positionsSettled} pos
        </span>
        {s.onChain && s.txSignature ? (
          <a
            href={explorerTx(s.txSignature)}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 hover:underline font-mono"
          >
            ⛓ {s.txSignature.slice(0, 6)}…
          </a>
        ) : (
          <span className="text-zinc-600">
            {s.status === "failed" ? "failed" : "internal"}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-600">
      {children}
    </div>
  );
}
