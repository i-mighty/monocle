/**
 * Client for the TxLINE Agent-vs-Agent Arena backend.
 *
 * All read endpoints are public (no API key), so the dashboard polls them
 * directly. Set NEXT_PUBLIC_BACKEND_URL to point at a deployed backend.
 */

import { fetchJson } from "./api";

export type StrategyId = "sharp-follower" | "contrarian-value";
export type SelectionKey = "HOME" | "DRAW" | "AWAY";

export interface ArenaAgentStats {
  id: string;
  name: string;
  solName: string;
  strategy: StrategyId;
  walletPubkey: string;
  balanceLamports: number;
  startingBankrollLamports: number;
  realizedPnlLamports: number;
  unrealizedPnlLamports: number;
  netPnlLamports: number;
  equityLamports: number;
  positionsOpen: number;
  positionsSettled: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface ArenaOverview {
  mode: "sim" | "live";
  running: boolean;
  tickCount: number;
  lastTickAt: number;
  lastError: string | null;
  stakeLamports: number;
  config: { moveThreshold: number; lookback: number; minProb: number; maxProb: number };
  agents: ArenaAgentStats[];
  leader: string | null;
  openPositions: number;
  totalSettlements: number;
}

export interface Selection {
  key: SelectionKey;
  label: string;
  decimalOdds: number;
  prob: number;
}

export interface MatchSnapshot {
  fixtureId: number;
  competition: string;
  competitionId: number;
  home: string;
  away: string;
  startTime: number;
  status: "scheduled" | "live" | "finished";
  observedAt: number;
  market: {
    fixtureId: number;
    marketType: string;
    period: string;
    inRunning: boolean;
    ts: number;
    bookmakerCount: number;
    selections: Selection[];
  } | null;
  score: { home: number; away: number; minute: number; gameState: string } | null;
}

export interface ProbPoint {
  ts: number;
  observedAt: number;
  probs: Record<SelectionKey, number>;
  inRunning: boolean;
}

export interface ArenaPosition {
  id: string;
  agentId: string;
  strategy: StrategyId;
  fixtureId: number;
  selection: SelectionKey;
  stakeLamports: number;
  entryProb: number;
  entryOdds: number;
  shares: number;
  status: "open" | "settled";
  markProb: number;
  unrealizedPnlLamports: number;
  realizedPnlLamports: number;
  won: boolean | null;
  reason: string;
  confidence: number;
  openedAt: number;
  settledAt: number | null;
}

export interface ArenaSignal {
  id: string;
  at: number;
  strategy: StrategyId;
  fixtureId: number;
  selection: SelectionKey;
  entryProb: number;
  move: number;
  confidence: number;
  reason: string;
  acted: boolean;
}

export interface ArenaSettlement {
  id: string;
  at: number;
  fixtureId: number;
  agentId: string;
  netPnlLamports: number;
  grossWinningsLamports: number;
  positionsSettled: number;
  txSignature: string | null;
  onChain: boolean;
  status: "confirmed" | "settled_internal" | "failed";
  error?: string;
}

const unwrap = <T>(p: Promise<{ success: boolean; data: T }>): Promise<T> => p.then((r) => r.data);

export const getArenaOverview = () => unwrap<ArenaOverview>(fetchJson("/v1/arena/overview"));
export const getArenaMatches = () => unwrap<MatchSnapshot[]>(fetchJson("/v1/arena/matches"));
export const getArenaMatch = (fixtureId: number) =>
  unwrap<{ snapshot: MatchSnapshot; history: ProbPoint[]; positions: ArenaPosition[] }>(
    fetchJson(`/v1/arena/matches/${fixtureId}`)
  );
export const getArenaPositions = (status?: "open" | "settled") =>
  unwrap<ArenaPosition[]>(fetchJson(`/v1/arena/positions${status ? `?status=${status}` : ""}`));
export const getArenaSignals = (limit = 30) =>
  unwrap<ArenaSignal[]>(fetchJson(`/v1/arena/signals?limit=${limit}`));
export const getArenaSettlements = (limit = 30) =>
  unwrap<ArenaSettlement[]>(fetchJson(`/v1/arena/settlements?limit=${limit}`));

// ---- formatting helpers ----
export const SOL = 1_000_000_000;
export const fmtSol = (lamports: number): string => {
  const sol = lamports / SOL;
  const sign = sol > 0 ? "+" : "";
  return `${sign}${sol.toFixed(6)} SOL`;
};
export const fmtLamports = (n: number): string => `${n > 0 ? "+" : ""}${n.toLocaleString()} ⊙`;
export const pct = (p: number): string => `${(p * 100).toFixed(1)}%`;
export const explorerTx = (sig: string): string =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
