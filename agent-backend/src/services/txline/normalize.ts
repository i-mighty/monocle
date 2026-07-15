/**
 * Normalization: TxLINE wire payloads → Monocle consensus snapshots.
 *
 * The math here is the heart of the data layer, so it is deliberately small,
 * pure, and unit-testable:
 *
 *   1. Decode each bookmaker's 1x2 prices into probabilities.
 *      - Prefer TxLINE's `Pct` (already vig-free, summed to ~100%).
 *      - Fall back to de-vigging the raw `Prices` ourselves:
 *          rawProb_i = 100 / price_i           (price is decimal-odds × 100)
 *          prob_i    = rawProb_i / Σ rawProb   (proportional overround removal)
 *   2. Aggregate across bookmakers into a single consensus by averaging each
 *      selection's probability, then renormalizing so Σ prob == 1.
 *
 * Everything downstream (strategies, PnL) consumes the consensus probability,
 * which is the cleanest, most defensible signal TxLINE exposes.
 */

import { MarketSnapshot, Selection, SelectionKey, TxOddsPayload } from "./types";

/** Map a TxLINE 1x2 price label to our canonical selection key. */
function labelToKey(label: string): SelectionKey | null {
  switch (label.trim()) {
    case "1":
      return "HOME";
    case "X":
      return "DRAW";
    case "2":
      return "AWAY";
    default:
      return null;
  }
}

interface DecodedBook {
  probs: Partial<Record<SelectionKey, number>>;
  odds: Partial<Record<SelectionKey, number>>;
}

/** Decode one bookmaker's 1x2 payload into per-selection prob + decimal odds. */
function decodeBook(p: TxOddsPayload): DecodedBook | null {
  const names = p.PriceNames;
  const prices = p.Prices;
  if (!names || !prices || names.length !== prices.length) return null;

  const probs: Partial<Record<SelectionKey, number>> = {};
  const odds: Partial<Record<SelectionKey, number>> = {};

  // First pass: decimal odds + raw implied prob (may carry overround).
  const raw: Partial<Record<SelectionKey, number>> = {};
  let rawSum = 0;
  for (let i = 0; i < names.length; i++) {
    const key = labelToKey(names[i]);
    if (!key) continue;
    const price = prices[i];
    if (!price || price <= 0) continue;
    const decimal = price / 100;
    odds[key] = decimal;

    // Prefer TxLINE's vig-free Pct when present and numeric.
    const pctStr = p.Pct?.[i];
    if (pctStr && pctStr !== "NA") {
      const pct = Number(pctStr);
      if (Number.isFinite(pct)) {
        probs[key] = pct / 100;
        continue;
      }
    }
    const rp = 100 / price; // = 1 / decimalOdds
    raw[key] = rp;
    rawSum += rp;
  }

  // Second pass: for any selection without a Pct, de-vig the raw probs.
  if (rawSum > 0) {
    for (const k of Object.keys(raw) as SelectionKey[]) {
      probs[k] = (raw[k] as number) / rawSum;
    }
  }

  // Require a full 1x2 triple to be useful.
  if (probs.HOME == null || probs.DRAW == null || probs.AWAY == null) return null;
  return { probs, odds };
}

/**
 * Build a consensus 1x2 market snapshot from every bookmaker payload for a
 * fixture. Returns null if no usable 1x2 books were present.
 */
export function consensus1x2(payloads: TxOddsPayload[]): MarketSnapshot | null {
  const books: DecodedBook[] = [];
  let latestTs = 0;
  let inRunning = false;
  let period = "FT";

  for (const p of payloads) {
    if ((p.SuperOddsType || "").toLowerCase() !== "1x2") continue;
    // Match-result market is the full-time period; skip half markets.
    if (p.MarketPeriod && p.MarketPeriod !== "FT") continue;
    const decoded = decodeBook(p);
    if (!decoded) continue;
    books.push(decoded);
    latestTs = Math.max(latestTs, p.Ts || 0);
    inRunning = inRunning || !!p.InRunning;
    if (p.MarketPeriod) period = p.MarketPeriod;
  }

  if (books.length === 0) return null;

  const keys: SelectionKey[] = ["HOME", "DRAW", "AWAY"];
  const probSum: Record<SelectionKey, number> = { HOME: 0, DRAW: 0, AWAY: 0 };
  const oddsSum: Record<SelectionKey, number> = { HOME: 0, DRAW: 0, AWAY: 0 };
  const oddsCount: Record<SelectionKey, number> = { HOME: 0, DRAW: 0, AWAY: 0 };

  for (const b of books) {
    for (const k of keys) {
      probSum[k] += b.probs[k] as number;
      if (b.odds[k] != null) {
        oddsSum[k] += b.odds[k] as number;
        oddsCount[k] += 1;
      }
    }
  }

  // Average probability, then renormalize to remove residual rounding drift.
  const avgProb: Record<SelectionKey, number> = {
    HOME: probSum.HOME / books.length,
    DRAW: probSum.DRAW / books.length,
    AWAY: probSum.AWAY / books.length,
  };
  const norm = avgProb.HOME + avgProb.DRAW + avgProb.AWAY || 1;

  const labelOf: Record<SelectionKey, string> = { HOME: "1", DRAW: "X", AWAY: "2" };
  const selections: Selection[] = keys.map((k) => {
    const prob = avgProb[k] / norm;
    const avgOdds = oddsCount[k] > 0 ? oddsSum[k] / oddsCount[k] : prob > 0 ? 1 / prob : 0;
    return {
      key: k,
      label: labelOf[k],
      decimalOdds: round(avgOdds, 3),
      prob: round(prob, 6),
    };
  });

  return {
    fixtureId: payloads[0]?.FixtureId ?? 0,
    marketType: "1x2",
    period,
    inRunning,
    ts: latestTs,
    bookmakerCount: books.length,
    selections,
  };
}

export function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Convenience: pull a selection out of a market by key. */
export function pick(market: MarketSnapshot, key: SelectionKey): Selection | undefined {
  return market.selections.find((s) => s.key === key);
}
