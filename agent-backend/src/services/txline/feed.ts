/**
 * Unified TxLINE feed.
 *
 * One interface over two interchangeable sources:
 *   - `sim`  : the deterministic WorldCupSimulator (default; runs offline).
 *   - `live` : the real TxlineClient hitting the World Cup feed.
 *
 * Selected by TXLINE_MODE. Both yield identical normalized `MatchSnapshot`s, so
 * everything downstream (strategies, engine, API, dashboard) is mode-agnostic.
 *
 * The feed also owns the short per-fixture probability history that strategies
 * read for their lookback windows — a bounded ring buffer per fixture.
 */

import { MatchResult, MatchSnapshot, SelectionKey } from "./types";
import { WorldCupSimulator } from "./simulator";
import { TxlineClient } from "./client";
import { consensus1x2 } from "./normalize";

export interface ProbPoint {
  ts: number; // odds timestamp (unix s) — or observedAt for sim
  observedAt: number; // wall clock ms
  probs: Record<SelectionKey, number>;
  inRunning: boolean;
}

export interface FeedTick {
  at: number;
  snapshots: MatchSnapshot[];
  resolved: MatchResult[];
}

interface FeedSource {
  poll(): Promise<{ snapshots: MatchSnapshot[]; resolved: MatchResult[] }>;
}

// ---------------------------------------------------------------------------
// Source: simulator
// ---------------------------------------------------------------------------
class SimSource implements FeedSource {
  constructor(private sim: WorldCupSimulator) {}
  async poll() {
    return this.sim.step();
  }
}

// ---------------------------------------------------------------------------
// Source: live TxLINE
// ---------------------------------------------------------------------------
class LiveSource implements FeedSource {
  private fixtures: MatchSnapshot[] = [];
  private fixturesFetchedAt = 0;
  private lastStatus = new Map<number, MatchSnapshot["status"]>();

  constructor(private client: TxlineClient) {}

  async poll() {
    await this.refreshFixtures();
    const snapshots: MatchSnapshot[] = [];
    const resolved: MatchResult[] = [];

    for (const base of this.fixtures) {
      const snap = await this.buildSnapshot(base).catch((e) => {
        console.warn(`[txline] odds/scores failed for ${base.fixtureId}: ${e?.message ?? e}`);
        return base;
      });
      snapshots.push(snap);

      const prev = this.lastStatus.get(snap.fixtureId);
      if (prev !== "finished" && snap.status === "finished" && snap.score) {
        const { home, away } = snap.score;
        resolved.push({
          fixtureId: snap.fixtureId,
          home,
          away,
          winner: home > away ? "HOME" : home < away ? "AWAY" : "DRAW",
        });
      }
      this.lastStatus.set(snap.fixtureId, snap.status);
    }
    return { snapshots, resolved };
  }

  /** Re-pull the fixtures list at most every 10 minutes. */
  private async refreshFixtures() {
    if (Date.now() - this.fixturesFetchedAt < 10 * 60 * 1000 && this.fixtures.length) return;
    const list = await this.client.fixturesSnapshot();
    this.fixtures = list.map((f) => ({
      fixtureId: f.FixtureId,
      competition: f.Competition,
      competitionId: f.CompetitionId,
      home: f.Participant1IsHome ? f.Participant1 : f.Participant2,
      away: f.Participant1IsHome ? f.Participant2 : f.Participant1,
      startTime: f.StartTime,
      status: "scheduled" as const,
      observedAt: Date.now(),
      market: null,
      score: null,
    }));
    this.fixturesFetchedAt = Date.now();
  }

  private async buildSnapshot(base: MatchSnapshot): Promise<MatchSnapshot> {
    const payloads = await this.client.liveOdds(base.fixtureId);
    const market = consensus1x2(payloads);

    let score = base.score;
    let status: MatchSnapshot["status"] = base.status;
    try {
      const scores = await this.client.scores(base.fixtureId);
      const latest = scores[scores.length - 1];
      if (latest?.scoreSoccer) {
        const h = latest.scoreSoccer.Participant1?.["Total"]?.Goals ?? 0;
        const a = latest.scoreSoccer.Participant2?.["Total"]?.Goals ?? 0;
        const finished = (latest.gameState ?? "").toLowerCase().includes("finish");
        score = { home: h, away: a, minute: finished ? 90 : 0, gameState: latest.gameState ?? "" };
        status = finished ? "finished" : market?.inRunning ? "live" : base.status;
      }
    } catch {
      /* scores optional — odds alone still drive signals */
    }
    if (status === "scheduled" && market?.inRunning) status = "live";

    return { ...base, market, score, status, observedAt: Date.now() };
  }
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------
export class TxlineFeed {
  readonly mode: "sim" | "live";
  private source: FeedSource;
  private history = new Map<number, ProbPoint[]>();
  private latest = new Map<number, MatchSnapshot>();
  private historyCap: number;
  private lastTickAt = 0;

  constructor() {
    this.mode = (process.env.TXLINE_MODE ?? "sim").toLowerCase() === "live" ? "live" : "sim";
    this.historyCap = Number(process.env.ARENA_HISTORY_CAP ?? 64);
    this.source = this.mode === "live" ? new LiveSource(new TxlineClient()) : new SimSource(new WorldCupSimulator());
  }

  /** Poll the underlying source once, update history + latest, return the tick. */
  async tickOnce(): Promise<FeedTick> {
    const { snapshots, resolved } = await this.source.poll();
    const at = Date.now();
    this.lastTickAt = at;

    for (const s of snapshots) {
      this.latest.set(s.fixtureId, s);
      if (s.market) {
        const probs: Record<SelectionKey, number> = { HOME: 0, DRAW: 0, AWAY: 0 };
        for (const sel of s.market.selections) probs[sel.key] = sel.prob;
        const buf = this.history.get(s.fixtureId) ?? [];
        buf.push({ ts: s.market.ts, observedAt: s.observedAt, probs, inRunning: s.market.inRunning });
        while (buf.length > this.historyCap) buf.shift();
        this.history.set(s.fixtureId, buf);
      }
    }
    return { at, snapshots, resolved };
  }

  getSnapshots(): MatchSnapshot[] {
    return [...this.latest.values()].sort((a, b) => a.fixtureId - b.fixtureId);
  }

  getSnapshot(fixtureId: number): MatchSnapshot | undefined {
    return this.latest.get(fixtureId);
  }

  getHistory(fixtureId: number): ProbPoint[] {
    return this.history.get(fixtureId) ?? [];
  }

  getLastTickAt(): number {
    return this.lastTickAt;
  }
}
