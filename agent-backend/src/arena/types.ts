/**
 * Arena domain types shared by the engine, accounting, persistence and API.
 */

import { SelectionKey } from "../services/txline/types";
import { StrategyId } from "./strategies";

export interface ArenaAgent {
  id: string; // e.g. "arena-sharp-follower"
  name: string;
  solName: string; // .sol identity, reused from Monocle identity convention
  strategy: StrategyId;
  walletPubkey: string; // on-chain settlement destination (devnet)
  /** Realized lamport balance, starting from the seeded bankroll. */
  balanceLamports: number;
  startingBankrollLamports: number;
}

export type PositionStatus = "open" | "settled";

export interface ArenaPosition {
  id: string;
  agentId: string;
  strategy: StrategyId;
  fixtureId: number;
  selection: SelectionKey;
  stakeLamports: number;
  /** Consensus probability paid at entry (the "share price"). */
  entryProb: number;
  entryOdds: number;
  /** stake / entryProb — number of outcome shares held. */
  shares: number;
  status: PositionStatus;
  /** Latest mark-to-market consensus probability. */
  markProb: number;
  unrealizedPnlLamports: number;
  realizedPnlLamports: number;
  won: boolean | null;
  reason: string;
  confidence: number;
  openedAt: number;
  settledAt: number | null;
}

export interface ArenaSignalRecord {
  id: string;
  at: number;
  strategy: StrategyId;
  fixtureId: number;
  selection: SelectionKey;
  entryProb: number;
  move: number;
  confidence: number;
  reason: string;
  /** Did it become a position, or was it skipped (e.g. duplicate)? */
  acted: boolean;
}

export interface ArenaSettlementRecord {
  id: string;
  at: number;
  fixtureId: number;
  agentId: string;
  netPnlLamports: number;
  grossWinningsLamports: number;
  positionsSettled: number;
  /** On-chain devnet tx signature, or null for internal-only settlement. */
  txSignature: string | null;
  onChain: boolean;
  status: "confirmed" | "settled_internal" | "failed";
  error?: string;
}
