# Monocle Arena — TxLINE Agent-vs-Agent World Cup

> **Track submission: TxLINE / TxODDS World Cup.**
> Two autonomous agents read the same live TxLINE consensus feed, run
> deliberately opposite strategies, price every bet as a prediction-market
> share, and **settle their P&L on Solana** at match resolution — on rails
> Monocle already runs in production.

---

## 1. Core idea

The TxLINE feed exposes a *vig-free consensus probability* (`Pct`) for every
outcome of every World Cup match, refreshed every ~60s. A change in that
consensus is the cleanest "sharp move" signal in sports betting: it is the
crowd of bookmakers repricing on new information, with the bookmaker margin
already stripped out.

The Arena puts two agents on that single signal with **opposite hypotheses**:

| Agent | `.sol` identity | Thesis on a sharp consensus move |
|---|---|---|
| **Sharp Follower** | `sharp-follower.monocle.sol` | *Momentum.* Money is moving toward this outcome for a reason — follow it. |
| **Contrarian Value** | `contrarian-value.monocle.sol` | *Mean reversion.* The market over-reacted; the now-cheaper outcome is value — fade it. |

They trade the same fixtures, tick for tick, for the whole tournament. The
better thesis compounds a larger on-chain balance. It is a live, falsifiable
experiment, not a backtest.

## 2. Why it fits the judging criteria

- **Data ingestion** — consumes the real TxLINE fixtures, live-odds, SSE and
  scores endpoints; normalizes multi-bookmaker 1×2 into a single vig-free
  consensus.
- **Autonomous operation** — a scheduler ticks the whole loop (ingest → signal
  → position → mark-to-market → settle) with zero human input. Starts on boot.
- **Logic & architecture** — strategies are *pure deterministic functions*;
  PnL is an explicit prediction-market share identity; the only stateful object
  is the engine. Seeded simulator ⇒ fully reproducible runs.
- **Innovation** — not "another odds dashboard". It is a self-settling,
  on-chain strategy tournament where the data feed is the referee.
- **Production readiness** — graceful degradation (runs with no DB and no
  Solana key), best-effort audit trail, admin-gated controls, integer-only
  lamport accounting, and it reuses a settlement rail that already moves real
  devnet SOL.

## 3. Architecture

```
TxLINE API ──┐
             │  (live mode)
             ▼
      TxlineClient ─────┐
                        ├──► TxlineFeed ──► ArenaEngine ──► settleToAgentWallet ──► Solana devnet
   WorldCupSimulator ───┘     (history)      │   ▲                                   (real SOL)
             ▲  (sim mode, default)          │   │
             │                       strategies (pure)
        seeded PRNG                  sharp-follower / contrarian-value
```

| Layer | File | Responsibility |
|---|---|---|
| Wire + domain types | `agent-backend/src/services/txline/types.ts` | Exact TxLINE JSON + normalized `MatchSnapshot` |
| Normalization | `…/txline/normalize.ts` | De-vig + multi-bookmaker consensus (pure) |
| Live client | `…/txline/client.ts` | Guest-JWT auth, fixtures, odds, scores |
| Simulator | `…/txline/simulator.ts` | Deterministic in-play Poisson goal model |
| Unified feed | `…/txline/feed.ts` | `sim`\|`live` behind one interface + prob history |
| Strategies | `agent-backend/src/arena/strategies.ts` | Two pure, opposite decision functions |
| Accounting | `…/arena/accounting.ts` | Prediction-market share PnL (integer lamports) |
| Engine | `…/arena/engine.ts` | The autonomous loop + on-chain settlement |
| Persistence | `…/arena/persistence.ts` | Best-effort audit trail to `arena_*` tables |
| API | `agent-backend/src/routes/arena.ts` | Public read API + admin controls |
| UI | `agent-dashboard/pages/arena.tsx` | Live scoreboard, signals, positions, receipts |

## 4. The math (defensible by construction)

**Consensus probability.** For each bookmaker's 1×2 we prefer TxLINE's vig-free
`Pct`; if absent we de-vig the raw decimal odds ourselves
(`p_i = (1/d_i) / Σ(1/d)`), then average across books and renormalize.

**Signal.** Over a lookback window of `L` ticks, `Δp = p_now − p_(now−L)` per
selection. Sharp Follower acts on the largest `+Δp ≥ θ`; Contrarian Value on the
largest `−Δp ≤ −θ`. Default `θ = 3pp`, `L = 3`.

**Position = prediction-market share.** A stake `S` at consensus probability
`p₀` buys `shares = S / p₀`, each settling at 1 (win) or 0 (lose):

```
mark-to-market = shares · p_t − S = S · (p_t/p₀ − 1)
settle(win)    = S · (1/p₀ − 1)  = S · (decimalOdds − 1)
settle(lose)   = −S
```

This is exactly the betting identity, which makes mid-match P&L and final
settlement consistent and auditable. All money is integer lamports.

**On-chain settlement.** At match resolution each agent's net winnings (if
positive) are transferred from the platform treasury to the agent's wallet on
Solana devnet via Monocle's existing `settleToAgentWallet`, and mirrored into
the platform `settlements` ledger. No key configured ⇒ internal-only settlement,
mirroring the platform's existing fallback.

## 5. TxLINE endpoints used

| Endpoint | Purpose |
|---|---|
| `POST /auth/guest/start` | Guest JWT (grants World Cup 2026 odds, 60s sampling) |
| `GET /api/fixtures/snapshot` | Discover World Cup fixtures |
| `GET /api/odds/updates/{fixtureId}` | Live 1×2 consensus odds (`Pct`, `Prices`) |
| `GET /api/odds/stream` | Real-time SSE odds (documented; polling path implemented) |
| `GET /api/scores/snapshot/{fixtureId}` | Resolve match outcomes for settlement |

Auth scheme: `Authorization: Bearer <guest JWT>` + optional `X-Api-Token` for
paid tiers. On-chain Merkle-proof validation (`/api/scores/stat-validation`) is
the natural next integration for trustless settlement triggers.

## 6. Running it

```bash
# Backend (defaults to deterministic sim mode — no keys needed)
cd agent-backend && npm install && npm run build && node dist/app.js
# → Arena starts automatically; ticks every 60s.

# Watch it live
curl localhost:3001/v1/arena/overview

# Dashboard
cd agent-dashboard && npm install && npm run dev   # → http://localhost:3000/arena
```

### Configuration

| Env | Default | Meaning |
|---|---|---|
| `TXLINE_MODE` | `sim` | `sim` (offline, deterministic) or `live` (real TxLINE) |
| `TXLINE_BASE_URL` | `https://txline.txodds.com` | TxLINE API base |
| `TXLINE_API_TOKEN` | — | `X-Api-Token` for paid tiers (guest JWT auto-fetched) |
| `TXLINE_COMPETITION_ID` | — | Filter fixtures to the World Cup competition |
| `ARENA_ENABLED` | `true` | Master switch for the loop |
| `ARENA_TICK_MS` | `60000` | Loop cadence (matches TxLINE's 60s sampling) |
| `ARENA_STAKE_LAMPORTS` | `20000` | Stake per signal |
| `ARENA_MOVE_THRESHOLD` | `0.03` | Min consensus move (prob units) to act |
| `ARENA_LOOKBACK` | `3` | Ticks over which the move is measured |
| `ARENA_SIM_MINUTES_PER_TICK` | `9` | Sim pacing (lower = matches last longer) |
| `ARENA_AGENT_A_PUBKEY` / `_B_PUBKEY` | generated | Stable settlement wallets |
| `SOLANA_PAYER_SECRET` | — | Platform treasury key → enables real devnet transfers |

For real on-chain settlement set `SOLANA_PAYER_SECRET` (a funded devnet keypair)
and `ARENA_AGENT_A/B_PUBKEY`. For the audit trail, apply
`agent-backend/src/db/arena.sql` against `DATABASE_URL`.

## 7. API

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/arena/overview` | Scoreboard: agents, P&L, leader, mode |
| GET | `/v1/arena/matches` | Latest consensus snapshot per fixture |
| GET | `/v1/arena/matches/:id` | One fixture + probability history + positions |
| GET | `/v1/arena/positions?status=open\|settled&agentId=` | Positions |
| GET | `/v1/arena/signals?limit=` | Recent strategy signals |
| GET | `/v1/arena/settlements?limit=` | On-chain / internal settlements |
| POST | `/v1/arena/tick` \| `/start` \| `/stop` \| `/reset` | Admin (`X-Admin-Key`) |

## 8. TxLINE API feedback

**What worked well**

- **The vig-free `Pct` field is the standout.** Most odds feeds hand you raw
  prices and leave de-vigging to you; shipping a normalized, margin-removed
  consensus probability per selection meant our strategy signal was clean from
  the first request. It is the single best design choice in the schema.
- **One normalized schema across competitions** is exactly as advertised — the
  same `OddsPayload` shape works for any fixture, so scaling from one match to
  all 104 is just a fixture list.
- **Guest tier with a 30-day JWT and no on-chain step** removed all onboarding
  friction for a hackathon — we could ingest World Cup odds in one POST.
- **Integer-encoded odds** (`Prices` = decimal × 100) keep everything exact and
  play nicely with our lamport-only accounting.

**Where we hit friction**

- **Endpoint discovery.** The `/quickstart` and `/worldcup` pages focus on
  subscription/setup; the concrete data paths only surfaced via `llms.txt` and
  `openapi.json`. A single "data endpoints" table up front would save time.
- **`competitionId` for the World Cup isn't documented** anywhere we could find,
  so live filtering to just WC fixtures is currently guesswork — we left it
  configurable via `TXLINE_COMPETITION_ID`.
- **`Pct` = "NA" on quarter-handicap lines** is sensible, but it would help to
  state explicitly which `SuperOddsType`s always carry a full `Pct` vector so
  consumers know which markets are "consensus-ready" without probing.
- **`Prices` units** (decimal × 100) are inferable from examples but not stated
  in the field description — worth a one-line note to prevent off-by-100 bugs.

