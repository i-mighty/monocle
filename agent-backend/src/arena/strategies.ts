/**
 * Arena strategies — pure, deterministic decision functions.
 *
 * Both strategies read the SAME TxLINE consensus feed and the same short
 * probability history, and take DELIBERATELY OPPOSITE views of a "sharp move"
 * (a fast shift in the vig-free consensus probability of a selection):
 *
 *   sharp-follower   : momentum. When consensus money moves toward a
 *                      selection faster than a threshold, follow it — the
 *                      market is pricing in real information.
 *
 *   contrarian-value : mean-reversion. When consensus money moves AWAY from a
 *                      selection sharply (an over-reaction), back that
 *                      now-cheaper selection for value.
 *
 * They are pure: `evaluate(input) -> Signal | null`. No I/O, no clocks, no
 * randomness. Given the same feed history they always produce the same signal,
 * which is what makes the head-to-head auditable and reproducible.
 *
 * A "signal" is an intent to open a fixed-stake position on one selection of
 * one fixture. The engine is responsible for sizing, execution, and PnL.
 */

import { MatchSnapshot, Selection, SelectionKey } from "../services/txline/types";
import { ProbPoint } from "../services/txline/feed";

export type StrategyId = "sharp-follower" | "contrarian-value";

export interface StrategyConfig {
  /** Min absolute consensus probability move (in prob units) to act on. */
  moveThreshold: number;
  /** How many history points back to measure the move over. */
  lookback: number;
  /** Don't bet a selection priced below this (avoids near-certain longshots). */
  minProb: number;
  /** Don't bet a selection priced above this (avoids near-locked favorites). */
  maxProb: number;
}

export const DEFAULT_CONFIG: StrategyConfig = {
  moveThreshold: Number(process.env.ARENA_MOVE_THRESHOLD ?? 0.03),
  lookback: Number(process.env.ARENA_LOOKBACK ?? 3),
  minProb: Number(process.env.ARENA_MIN_PROB ?? 0.08),
  maxProb: Number(process.env.ARENA_MAX_PROB ?? 0.92),
};

export interface Signal {
  strategy: StrategyId;
  fixtureId: number;
  selection: SelectionKey;
  /** Consensus probability at signal time (entry "price" of the share). */
  entryProb: number;
  /** Consensus decimal odds at signal time. */
  entryOdds: number;
  /** Magnitude of the consensus move that triggered it (prob units). */
  move: number;
  /** 0..1 confidence, scaled from move size. */
  confidence: number;
  reason: string;
}

export interface StrategyInput {
  snapshot: MatchSnapshot;
  history: ProbPoint[];
  config: StrategyConfig;
}

/** Δ of each selection's consensus probability over the lookback window. */
function computeMoves(history: ProbPoint[], lookback: number): Record<SelectionKey, number> | null {
  if (history.length < lookback + 1) return null;
  const now = history[history.length - 1];
  const past = history[history.length - 1 - lookback];
  if (!now.inRunning) return null; // only trade in-play moves
  return {
    HOME: now.probs.HOME - past.probs.HOME,
    DRAW: now.probs.DRAW - past.probs.DRAW,
    AWAY: now.probs.AWAY - past.probs.AWAY,
  };
}

function tradeable(prob: number, cfg: StrategyConfig): boolean {
  return prob >= cfg.minProb && prob <= cfg.maxProb;
}

function confidenceFromMove(move: number, cfg: StrategyConfig): number {
  // Linear ramp from threshold→threshold*4, clamped to [0,1].
  const c = (Math.abs(move) - cfg.moveThreshold) / (cfg.moveThreshold * 3);
  return Math.max(0, Math.min(1, c));
}

// ---------------------------------------------------------------------------
// sharp-follower: back the selection whose consensus prob ROSE the most.
// ---------------------------------------------------------------------------
export function evaluateSharpFollower(input: StrategyInput): Signal | null {
  const { snapshot, history, config } = input;
  if (!snapshot.market) return null;
  const moves = computeMoves(history, config.lookback);
  if (!moves) return null;

  let best: SelectionKey | null = null;
  let bestMove = config.moveThreshold; // must exceed threshold to fire
  for (const k of ["HOME", "DRAW", "AWAY"] as SelectionKey[]) {
    if (moves[k] > bestMove) {
      bestMove = moves[k];
      best = k;
    }
  }
  if (!best) return null;

  const sel = snapshot.market.selections.find((s: Selection) => s.key === best)!;
  if (!tradeable(sel.prob, config)) return null;

  return {
    strategy: "sharp-follower",
    fixtureId: snapshot.fixtureId,
    selection: best,
    entryProb: sel.prob,
    entryOdds: sel.decimalOdds,
    move: round(bestMove, 6),
    confidence: round(confidenceFromMove(bestMove, config), 4),
    reason: `consensus on ${best} rose +${(bestMove * 100).toFixed(1)}pp over ${config.lookback} ticks — following sharp money`,
  };
}

// ---------------------------------------------------------------------------
// contrarian-value: back the selection whose consensus prob FELL the most.
// ---------------------------------------------------------------------------
export function evaluateContrarianValue(input: StrategyInput): Signal | null {
  const { snapshot, history, config } = input;
  if (!snapshot.market) return null;
  const moves = computeMoves(history, config.lookback);
  if (!moves) return null;

  let worst: SelectionKey | null = null;
  let worstMove = -config.moveThreshold; // must drop past threshold
  for (const k of ["HOME", "DRAW", "AWAY"] as SelectionKey[]) {
    if (moves[k] < worstMove) {
      worstMove = moves[k];
      worst = k;
    }
  }
  if (!worst) return null;

  const sel = snapshot.market.selections.find((s: Selection) => s.key === worst)!;
  if (!tradeable(sel.prob, config)) return null;

  return {
    strategy: "contrarian-value",
    fixtureId: snapshot.fixtureId,
    selection: worst,
    entryProb: sel.prob,
    entryOdds: sel.decimalOdds,
    move: round(worstMove, 6),
    confidence: round(confidenceFromMove(worstMove, config), 4),
    reason: `consensus on ${worst} dropped ${(worstMove * 100).toFixed(1)}pp over ${config.lookback} ticks — fading the over-reaction for value`,
  };
}

export const STRATEGIES: Record<StrategyId, (input: StrategyInput) => Signal | null> = {
  "sharp-follower": evaluateSharpFollower,
  "contrarian-value": evaluateContrarianValue,
};

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
