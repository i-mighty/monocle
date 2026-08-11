/**
 * TxLINE HTTP client.
 *
 * Thin, dependency-free wrapper (uses Node 18+ global fetch) over the TxLINE
 * REST API. Handles the guest-session JWT lifecycle and the dual-header auth
 * scheme:
 *
 *   Authorization: Bearer <session JWT>     (from POST /auth/guest/start)
 *   X-Api-Token:   <long-lived API token>   (optional, paid tiers)
 *
 * The guest tier alone grants World Cup 2026 odds sampled every 60s, which is
 * exactly the cadence the Arena ticks at — so judges can run this live with no
 * on-chain subscription, just TXLINE_MODE=live.
 *
 * Endpoints used:
 *   POST /auth/guest/start
 *   GET  /api/fixtures/snapshot?startEpochDay&competitionId
 *   GET  /api/odds/updates/{fixtureId}
 *   GET  /api/scores/snapshot/{fixtureId}
 */

import { TxFixture, TxOddsPayload, TxScores } from "./types";

const DEFAULT_BASE = "https://txline.txodds.com";

export interface TxlineClientOptions {
  baseUrl?: string;
  /** Long-lived API token for X-Api-Token (paid tiers). Optional. */
  apiToken?: string;
  /** Pre-existing session JWT. If absent, a guest session is started lazily. */
  sessionToken?: string;
  /** Competition filter for fixtures (World Cup competition id). */
  competitionId?: number;
  fetchTimeoutMs?: number;
}

export class TxlineError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TxlineError";
  }
}

export class TxlineClient {
  private baseUrl: string;
  private apiToken?: string;
  private sessionToken?: string;
  private sessionStartedAt = 0;
  readonly competitionId?: number;
  private timeoutMs: number;

  constructor(opts: TxlineClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.TXLINE_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
    this.apiToken = opts.apiToken ?? process.env.TXLINE_API_TOKEN;
    this.sessionToken = opts.sessionToken ?? process.env.TXLINE_SESSION_TOKEN;
    this.competitionId =
      opts.competitionId ??
      (process.env.TXLINE_COMPETITION_ID ? Number(process.env.TXLINE_COMPETITION_ID) : undefined);
    this.timeoutMs = opts.fetchTimeoutMs ?? 15000;
  }

  /** Start (or reuse) a guest session JWT. Guest tokens last ~30 days. */
  async ensureSession(): Promise<string> {
    const ageMs = Date.now() - this.sessionStartedAt;
    if (this.sessionToken && ageMs < 25 * 24 * 60 * 60 * 1000) return this.sessionToken;

    const res = await this.raw("POST", "/auth/guest/start");
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new TxlineError("guest/start returned no token");
    this.sessionToken = body.token;
    this.sessionStartedAt = Date.now();
    return this.sessionToken;
  }

  /** Latest fixtures snapshot, optionally filtered to the configured competition. */
  async fixturesSnapshot(startEpochDay?: number): Promise<TxFixture[]> {
    const q = new URLSearchParams();
    if (startEpochDay != null) q.set("startEpochDay", String(startEpochDay));
    if (this.competitionId != null) q.set("competitionId", String(this.competitionId));
    const path = `/api/fixtures/snapshot${q.toString() ? `?${q}` : ""}`;
    return this.getJson<TxFixture[]>(path);
  }

  /** Currently-live odds updates for a single fixture (5-min in-memory cache). */
  async liveOdds(fixtureId: number): Promise<TxOddsPayload[]> {
    return this.getJson<TxOddsPayload[]>(`/api/odds/updates/${fixtureId}`);
  }

  /** Latest score snapshot for a fixture (used to resolve match outcomes). */
  async scores(fixtureId: number): Promise<TxScores[]> {
    return this.getJson<TxScores[]>(`/api/scores/snapshot/${fixtureId}`);
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private async getJson<T>(path: string): Promise<T> {
    await this.ensureSession();
    const res = await this.raw("GET", path, true);
    return (await res.json()) as T;
  }

  private async raw(method: string, path: string, authed = false): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authed) {
      if (this.sessionToken) headers["Authorization"] = `Bearer ${this.sessionToken}`;
      if (this.apiToken) headers["X-Api-Token"] = this.apiToken;
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new TxlineError(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`, res.status);
      }
      return res;
    } catch (err: any) {
      if (err instanceof TxlineError) throw err;
      throw new TxlineError(`${method} ${path} failed: ${err?.message ?? err}`);
    } finally {
      clearTimeout(t);
    }
  }
}
