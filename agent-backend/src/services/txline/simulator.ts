/**
 * Deterministic World Cup simulator.
 *
 * Produces the SAME normalized `MatchSnapshot` shape the live TxLINE path
 * produces, so the Arena engine is identical in `sim` and `live` modes. This
 * exists for two reasons:
 *   1. The 2026 World Cup matches are not live yet — judges still need to see
 *      the full ingest → signal → settle loop working end to end.
 *   2. Reproducibility: seeded by ARENA_SIM_SEED, every run is identical, which
 *      makes the strategy logic auditable.
 *
 * The in-play probability model is a compact Poisson goals model, not a random
 * walk: pre-match strengths give per-team scoring rates, and at any minute the
 * win/draw/win consensus is P(final goal differential) given the current score
 * and the remaining expected goals. Goals therefore cause realistic, sharp
 * consensus jumps — exactly the signal the two strategies are built to trade.
 */

import { MarketSnapshot, MatchResult, MatchSnapshot, SelectionKey } from "./types";
import { round } from "./normalize";

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — deterministic given the seed.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Poisson helpers for the in-play model.
// ---------------------------------------------------------------------------
function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // exp(-λ) λ^k / k!
  let logp = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logp -= Math.log(i);
  return Math.exp(logp);
}

/** P(HOME/DRAW/AWAY) given current score + remaining expected goals each side. */
function outcomeProbs(
  homeNow: number,
  awayNow: number,
  remHome: number,
  remAway: number
): Record<SelectionKey, number> {
  const MAX = 8; // future goals tail per side; negligible mass beyond
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  for (let h = 0; h <= MAX; h++) {
    const ph = poissonPmf(remHome, h);
    for (let a = 0; a <= MAX; a++) {
      const pa = poissonPmf(remAway, a);
      const joint = ph * pa;
      const finalHome = homeNow + h;
      const finalAway = awayNow + a;
      if (finalHome > finalAway) pHome += joint;
      else if (finalHome === finalAway) pDraw += joint;
      else pAway += joint;
    }
  }
  const s = pHome + pDraw + pAway || 1;
  return { HOME: pHome / s, DRAW: pDraw / s, AWAY: pAway / s };
}

// ---------------------------------------------------------------------------
// Fixture roster — a representative World Cup 2026 group slate.
// ---------------------------------------------------------------------------
interface SimMatch {
  fixtureId: number;
  home: string;
  away: string;
  /** Expected full-match goals per side (attack strength). */
  lambdaHome: number;
  lambdaAway: number;
  /** Tick index at which this match kicks off (staggered). */
  kickoffTick: number;
  // mutable live state
  minute: number;
  homeScore: number;
  awayScore: number;
  status: "scheduled" | "live" | "finished";
}

const ROSTER: Omit<SimMatch, "minute" | "homeScore" | "awayScore" | "status">[] = [
  { fixtureId: 2026001, home: "Argentina", away: "Nigeria", lambdaHome: 1.9, lambdaAway: 1.0, kickoffTick: 0 },
  { fixtureId: 2026002, home: "France", away: "Mexico", lambdaHome: 1.8, lambdaAway: 1.1, kickoffTick: 1 },
  { fixtureId: 2026003, home: "Brazil", away: "Japan", lambdaHome: 1.7, lambdaAway: 1.2, kickoffTick: 2 },
  { fixtureId: 2026004, home: "England", away: "USA", lambdaHome: 1.6, lambdaAway: 1.2, kickoffTick: 3 },
  { fixtureId: 2026005, home: "Spain", away: "Morocco", lambdaHome: 1.7, lambdaAway: 1.1, kickoffTick: 4 },
  { fixtureId: 2026006, home: "Germany", away: "Croatia", lambdaHome: 1.5, lambdaAway: 1.3, kickoffTick: 5 },
];

const COMPETITION = "FIFA World Cup 2026";
const COMPETITION_ID = 2026;

export interface SimulatorOptions {
  seed?: number;
  /** Virtual match-minutes advanced per tick (controls demo pacing). */
  minutesPerTick?: number;
  /** Small per-tick consensus noise (bookmaker disagreement), std in prob units. */
  noise?: number;
}

export class WorldCupSimulator {
  private rng: () => number;
  private matches: SimMatch[];
  private tick = 0;
  private minutesPerTick: number;
  private noise: number;
  private startTimeBase: number;

  constructor(opts: SimulatorOptions = {}) {
    const seed = opts.seed ?? Number(process.env.ARENA_SIM_SEED ?? 42);
    this.rng = mulberry32(seed);
    this.minutesPerTick = opts.minutesPerTick ?? Number(process.env.ARENA_SIM_MINUTES_PER_TICK ?? 9);
    this.noise = opts.noise ?? Number(process.env.ARENA_SIM_NOISE ?? 0.012);
    this.startTimeBase = Math.floor(Date.now() / 1000);
    this.matches = ROSTER.map((m) => ({
      ...m,
      minute: 0,
      homeScore: 0,
      awayScore: 0,
      status: "scheduled" as const,
    }));
  }

  /** Advance the virtual clock one tick, scoring goals and resolving matches. */
  step(): { snapshots: MatchSnapshot[]; resolved: MatchResult[] } {
    this.tick += 1;
    const resolved: MatchResult[] = [];

    for (const m of this.matches) {
      if (m.status === "finished") continue;

      if (m.status === "scheduled") {
        if (this.tick >= m.kickoffTick) m.status = "live";
        else continue;
      }

      // Advance match clock.
      const prevMinute = m.minute;
      m.minute = Math.min(90, m.minute + this.minutesPerTick);

      // Score goals over the minutes that just elapsed (thinned Poisson).
      const elapsed = m.minute - prevMinute;
      const homeGoals = this.drawGoals((m.lambdaHome * elapsed) / 90);
      const awayGoals = this.drawGoals((m.lambdaAway * elapsed) / 90);
      m.homeScore += homeGoals;
      m.awayScore += awayGoals;

      if (m.minute >= 90) {
        m.status = "finished";
        const winner: SelectionKey =
          m.homeScore > m.awayScore ? "HOME" : m.homeScore < m.awayScore ? "AWAY" : "DRAW";
        resolved.push({ fixtureId: m.fixtureId, home: m.homeScore, away: m.awayScore, winner });
      }
    }

    return { snapshots: this.snapshot(), resolved };
  }

  /** Current normalized snapshot of every match (no clock advance). */
  snapshot(): MatchSnapshot[] {
    return this.matches.map((m) => this.toSnapshot(m));
  }

  private drawGoals(lambda: number): number {
    // Small λ per tick → at most a couple of goals; draw via inverse-CDF.
    const u = this.rng();
    let cum = 0;
    for (let k = 0; k <= 5; k++) {
      cum += poissonPmf(lambda, k);
      if (u <= cum) return k;
    }
    return 0;
  }

  private toSnapshot(m: SimMatch): MatchSnapshot {
    let market: MarketSnapshot | null = null;
    if (m.status !== "scheduled") {
      const rem = Math.max(0, 90 - m.minute) / 90;
      const probs = outcomeProbs(m.homeScore, m.awayScore, m.lambdaHome * rem, m.lambdaAway * rem);

      // Add tiny consensus noise to emulate bookmaker disagreement, renormalize.
      const noisy: Record<SelectionKey, number> = {
        HOME: clamp01(probs.HOME + this.centeredNoise()),
        DRAW: clamp01(probs.DRAW + this.centeredNoise()),
        AWAY: clamp01(probs.AWAY + this.centeredNoise()),
      };
      const sum = noisy.HOME + noisy.DRAW + noisy.AWAY || 1;
      const labelOf: Record<SelectionKey, string> = { HOME: "1", DRAW: "X", AWAY: "2" };
      const keys: SelectionKey[] = ["HOME", "DRAW", "AWAY"];
      market = {
        fixtureId: m.fixtureId,
        marketType: "1x2",
        period: "FT",
        inRunning: m.status === "live",
        ts: Math.floor(Date.now() / 1000),
        bookmakerCount: 12,
        selections: keys.map((k) => {
          const prob = noisy[k] / sum;
          return {
            key: k,
            label: labelOf[k],
            decimalOdds: round(prob > 0 ? 1 / prob : 999, 3),
            prob: round(prob, 6),
          };
        }),
      };
    }

    return {
      fixtureId: m.fixtureId,
      competition: COMPETITION,
      competitionId: COMPETITION_ID,
      home: m.home,
      away: m.away,
      startTime: this.startTimeBase,
      status: m.status === "scheduled" ? "scheduled" : m.status === "live" ? "live" : "finished",
      observedAt: Date.now(),
      market,
      score:
        m.status === "scheduled"
          ? null
          : { home: m.homeScore, away: m.awayScore, minute: m.minute, gameState: m.status },
    };
  }

  private centeredNoise(): number {
    return (this.rng() - 0.5) * 2 * this.noise;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
