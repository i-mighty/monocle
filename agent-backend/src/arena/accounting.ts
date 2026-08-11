/**
 * Position accounting — prediction-market share model.
 *
 * A position is a stake `S` placed on a selection at consensus probability `p0`
 * (the "share price"). We treat it as buying `shares = S / p0` outcome shares,
 * each of which settles at 1.0 if the outcome wins and 0.0 if it loses. This is
 * exactly the betting identity, expressed cleanly:
 *
 *   shares          = S / p0
 *   mark-to-market  = shares * p_t - S = S * (p_t / p0 - 1)
 *   settle(win)     = shares * 1   - S = S * (1 / p0 - 1) = S * (decimalOdds - 1)
 *   settle(lose)    = shares * 0   - S = -S
 *
 * All money is integer lamports. Probabilities are floats; we round PnL to whole
 * lamports at the boundary so balances stay integer-exact, matching the rest of
 * Monocle's lamport-only accounting.
 */

import { SelectionKey } from "../services/txline/types";
import { ArenaPosition } from "./types";
import { StrategyId } from "./strategies";

export function openPosition(params: {
  id: string;
  agentId: string;
  strategy: StrategyId;
  fixtureId: number;
  selection: SelectionKey;
  stakeLamports: number;
  entryProb: number;
  entryOdds: number;
  confidence: number;
  reason: string;
  now: number;
}): ArenaPosition {
  const shares = params.stakeLamports / params.entryProb;
  return {
    id: params.id,
    agentId: params.agentId,
    strategy: params.strategy,
    fixtureId: params.fixtureId,
    selection: params.selection,
    stakeLamports: params.stakeLamports,
    entryProb: params.entryProb,
    entryOdds: params.entryOdds,
    shares,
    status: "open",
    markProb: params.entryProb,
    unrealizedPnlLamports: 0,
    realizedPnlLamports: 0,
    won: null,
    reason: params.reason,
    confidence: params.confidence,
    openedAt: params.now,
    settledAt: null,
  };
}

/** Mark an open position to the current consensus probability. */
export function markToMarket(pos: ArenaPosition, currentProb: number): void {
  if (pos.status !== "open") return;
  pos.markProb = currentProb;
  pos.unrealizedPnlLamports = Math.round(pos.shares * currentProb - pos.stakeLamports);
}

/** Settle a position against the resolved outcome. Returns realized PnL. */
export function settlePosition(pos: ArenaPosition, winner: SelectionKey, now: number): number {
  if (pos.status === "settled") return pos.realizedPnlLamports;
  const won = pos.selection === winner;
  const realized = won ? Math.round(pos.shares - pos.stakeLamports) : -pos.stakeLamports;
  pos.status = "settled";
  pos.won = won;
  pos.markProb = won ? 1 : 0;
  pos.unrealizedPnlLamports = 0;
  pos.realizedPnlLamports = realized;
  pos.settledAt = now;
  return realized;
}
