/**
 * TxLINE wire types + Monocle normalized domain model.
 *
 * Wire types mirror the TxLINE API JSON exactly (PascalCase, integer-encoded
 * odds). The normalized types are what the rest of Monocle's Arena consumes —
 * a single, sport-agnostic shape with floating probabilities already de-vigged.
 *
 * TxLINE encoding notes (from the API reference):
 *  - `Prices`  : decimal odds × 100   (180 → 1.80)
 *  - `Pct`     : vig-free consensus implied probability, percent, 3dp string
 *                ("32.143" → 0.32143) or "NA" for quarter-handicap lines.
 *  - `Ts`      : unix seconds.
 *  - `InRunning`: true while the match is in-play.
 */

// =============================================================================
// WIRE TYPES — exact TxLINE JSON shapes
// =============================================================================

/** GET /api/fixtures/snapshot → Fixture[] */
export interface TxFixture {
  Ts: number;
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  FixtureGroupId: number;
  Participant1Id: number;
  Participant1: string;
  Participant2Id: number;
  Participant2: string;
  FixtureId: number;
  Participant1IsHome: boolean;
}

/** GET /api/odds/updates/{fixtureId} and the SSE stream → OddsPayload[] */
export interface TxOddsPayload {
  FixtureId: number;
  MessageId: string;
  Ts: number;
  Bookmaker: string;
  BookmakerId: number;
  SuperOddsType: string; // e.g. "1x2", "OverUnder", "AsianHandicap"
  GameState?: string;
  InRunning: boolean;
  MarketParameters?: string;
  MarketPeriod?: string; // e.g. "FT", "1H"
  PriceNames?: string[]; // e.g. ["1","X","2"]
  Prices?: number[]; // decimal odds × 100
  Pct?: string[]; // vig-free implied prob %, 3dp, or "NA"
}

/** GET /api/scores/snapshot/{fixtureId} (soccer subset we care about) */
export interface TxSoccerStatBlock {
  Goals: number;
  YellowCards?: number;
  RedCards?: number;
  Corners?: number;
}
export interface TxScores {
  fixtureId: number;
  ts: number;
  seq: number;
  gameState?: string;
  participant1Id?: number;
  participant2Id?: number;
  scoreSoccer?: {
    Participant1?: Record<string, TxSoccerStatBlock>;
    Participant2?: Record<string, TxSoccerStatBlock>;
  };
}

// =============================================================================
// NORMALIZED DOMAIN MODEL — what the Arena engine consumes
// =============================================================================

/** A single outcome within a market (e.g. home win) at consensus. */
export interface Selection {
  /** Canonical key: "HOME" | "DRAW" | "AWAY" for 1x2. */
  key: SelectionKey;
  /** Raw TxLINE price name ("1" / "X" / "2"). */
  label: string;
  /** Consensus decimal odds (1.80). */
  decimalOdds: number;
  /** Consensus vig-free probability in [0,1]. The Arena's core signal. */
  prob: number;
}

export type SelectionKey = "HOME" | "DRAW" | "AWAY";

/** Consensus snapshot of the match-result (1x2 FT) market for one fixture. */
export interface MarketSnapshot {
  fixtureId: number;
  marketType: string; // "1x2"
  period: string; // "FT"
  inRunning: boolean;
  ts: number; // unix seconds of the underlying odds
  /** Number of bookmakers that fed this consensus. */
  bookmakerCount: number;
  selections: Selection[];
}

export type MatchStatus = "scheduled" | "live" | "finished";

export interface MatchScore {
  home: number;
  away: number;
  minute: number;
  gameState: string;
}

/** Everything the Arena knows about one fixture at a point in time. */
export interface MatchSnapshot {
  fixtureId: number;
  competition: string;
  competitionId: number;
  home: string;
  away: string;
  startTime: number; // unix seconds
  status: MatchStatus;
  /** Wall-clock of this normalized snapshot (ms). */
  observedAt: number;
  /** The 1x2 FT consensus market, if present. */
  market: MarketSnapshot | null;
  score: MatchScore | null;
}

/** Resolved outcome of a finished match, used for settlement. */
export interface MatchResult {
  fixtureId: number;
  home: number;
  away: number;
  winner: SelectionKey; // HOME | DRAW | AWAY
}
