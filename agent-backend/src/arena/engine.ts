/**
 * Arena engine — the autonomous head-to-head.
 *
 * Each tick:
 *   1. Poll the unified TxLINE feed (sim or live).
 *   2. Run BOTH strategies on every fixture's consensus market.
 *   3. Open at most one position per agent per fixture from any fresh signal.
 *   4. Mark every open position to the latest consensus probability.
 *   5. For any fixture that resolved this tick, settle both agents' positions
 *      and push net winnings on-chain via Monocle's existing settlement rail.
 *
 * The engine holds authoritative state in memory (so it runs with no DB and no
 * Solana key), and persists an audit trail + executes real devnet transfers
 * when those are configured. It is the only stateful object; the feed,
 * strategies and accounting are otherwise pure.
 */

import { Keypair } from "@solana/web3.js";
import { randomUUID } from "crypto";
import { TxlineFeed, FeedTick } from "../services/txline/feed";
import { MatchResult, MatchSnapshot, Selection } from "../services/txline/types";
import { DEFAULT_CONFIG, STRATEGIES, Signal, StrategyConfig } from "./strategies";
import { markToMarket, openPosition, settlePosition } from "./accounting";
import { ArenaAgent, ArenaPosition, ArenaSettlementRecord, ArenaSignalRecord } from "./types";
import { settleToAgentWallet, isSolanaPayerReady, ensureWalletRentExempt } from "../services/solanaService";
import { query } from "../db/client";
import { persistAgent, persistPosition, persistSettlement, persistSignal } from "./persistence";

const STAKE_LAMPORTS = Number(process.env.ARENA_STAKE_LAMPORTS ?? 20000);
const STARTING_BANKROLL = Number(process.env.ARENA_BANKROLL_LAMPORTS ?? 1_000_000);
const SIGNAL_LOG_CAP = 200;

function seedWallet(envKey: string): string {
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  // Generate an ephemeral devnet destination so there is always a real address
  // to settle to and show in the explorer. Override via env for a stable wallet.
  return Keypair.generate().publicKey.toBase58();
}

const AGENT_DEFS: Omit<ArenaAgent, "balanceLamports" | "startingBankrollLamports" | "walletPubkey">[] = [
  { id: "arena-sharp-follower", name: "Sharp Follower", solName: "sharp-follower.monocle.sol", strategy: "sharp-follower" },
  { id: "arena-contrarian-value", name: "Contrarian Value", solName: "contrarian-value.monocle.sol", strategy: "contrarian-value" },
];

export class ArenaEngine {
  private feed = new TxlineFeed();
  private config: StrategyConfig = { ...DEFAULT_CONFIG };
  private agents = new Map<string, ArenaAgent>();
  private positions: ArenaPosition[] = [];
  private signals: ArenaSignalRecord[] = [];
  private settlements: ArenaSettlementRecord[] = [];
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private running = false;
  private lastError: string | null = null;

  constructor() {
    for (const def of AGENT_DEFS) {
      const envKey = def.strategy === "sharp-follower" ? "ARENA_AGENT_A_PUBKEY" : "ARENA_AGENT_B_PUBKEY";
      this.agents.set(def.id, {
        ...def,
        walletPubkey: seedWallet(envKey),
        startingBankrollLamports: STARTING_BANKROLL,
        balanceLamports: STARTING_BANKROLL,
      });
    }
  }

  get mode() {
    return this.feed.mode;
  }

  async init(): Promise<void> {
    for (const a of this.agents.values()) await persistAgent(a);

    // If on-chain settlement is enabled, make sure each agent wallet is
    // rent-exempt so it can receive micro-settlements. One-time, idempotent.
    if (isSolanaPayerReady()) {
      for (const a of this.agents.values()) {
        try {
          const sig = await ensureWalletRentExempt(a.walletPubkey);
          if (sig) console.log(`  🏟️  initialized ${a.solName} wallet (rent-exempt) tx ${sig}`);
        } catch (err: any) {
          console.warn(`[arena] could not initialize ${a.solName} wallet: ${err?.message ?? err}`);
        }
      }
    }
  }

  /** Start the autonomous loop. Idempotent. */
  start(intervalMs = Number(process.env.ARENA_TICK_MS ?? 60000)): void {
    if (this.timer) return;
    this.running = true;
    // Fire one tick immediately so the demo shows life without waiting a full interval.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    console.log(`  🏟️  Arena engine started (mode=${this.feed.mode}, tick=${intervalMs}ms, stake=${STAKE_LAMPORTS} lamports)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  /** One full autonomous step. Safe to call manually (API/tests). */
  async tick(): Promise<FeedTick> {
    this.tickCount += 1;
    let result: FeedTick;
    try {
      result = await this.feed.tickOnce();
      this.lastError = null;
    } catch (err: any) {
      this.lastError = err?.message ?? String(err);
      console.error(`[arena] feed tick failed: ${this.lastError}`);
      return { at: Date.now(), snapshots: this.feed.getSnapshots(), resolved: [] };
    }

    // 1. Generate signals + open positions.
    for (const snap of result.snapshots) {
      if (!snap.market || snap.status !== "live") continue;
      this.evaluateFixture(snap, result.at);
    }

    // 2. Mark all open positions to the latest consensus.
    this.markOpenPositions();

    // 3. Settle resolved matches (+ on-chain).
    for (const r of result.resolved) {
      await this.settleMatch(r, result.at);
    }

    return result;
  }

  private evaluateFixture(snap: MatchSnapshot, at: number): void {
    const history = this.feed.getHistory(snap.fixtureId);
    for (const agent of this.agents.values()) {
      const strat = STRATEGIES[agent.strategy];
      const signal = strat({ snapshot: snap, history, config: this.config });
      if (!signal) continue;

      const hasOpen = this.positions.some(
        (p) => p.agentId === agent.id && p.fixtureId === snap.fixtureId && p.status === "open"
      );
      const acted = !hasOpen;
      this.recordSignal(signal, acted, at);
      if (acted) this.openFromSignal(agent, signal, at);
    }
  }

  private recordSignal(signal: Signal, acted: boolean, at: number): void {
    const rec: ArenaSignalRecord = {
      id: randomUUID(),
      at,
      strategy: signal.strategy,
      fixtureId: signal.fixtureId,
      selection: signal.selection,
      entryProb: signal.entryProb,
      move: signal.move,
      confidence: signal.confidence,
      reason: signal.reason,
      acted,
    };
    this.signals.unshift(rec);
    if (this.signals.length > SIGNAL_LOG_CAP) this.signals.pop();
    void persistSignal(rec);
  }

  private openFromSignal(agent: ArenaAgent, signal: Signal, at: number): void {
    const pos = openPosition({
      id: randomUUID(),
      agentId: agent.id,
      strategy: agent.strategy,
      fixtureId: signal.fixtureId,
      selection: signal.selection,
      stakeLamports: STAKE_LAMPORTS,
      entryProb: signal.entryProb,
      entryOdds: signal.entryOdds,
      confidence: signal.confidence,
      reason: signal.reason,
      now: at,
    });
    this.positions.push(pos);
    void persistPosition(pos);
  }

  private markOpenPositions(): void {
    for (const pos of this.positions) {
      if (pos.status !== "open") continue;
      const snap = this.feed.getSnapshot(pos.fixtureId);
      const sel = snap?.market?.selections.find((s: Selection) => s.key === pos.selection);
      if (sel) markToMarket(pos, sel.prob);
    }
  }

  private async settleMatch(result: MatchResult, at: number): Promise<void> {
    for (const agent of this.agents.values()) {
      const open = this.positions.filter(
        (p) => p.agentId === agent.id && p.fixtureId === result.fixtureId && p.status === "open"
      );
      if (open.length === 0) continue;

      let net = 0;
      let grossWinnings = 0;
      for (const pos of open) {
        const realized = settlePosition(pos, result.winner, at);
        net += realized;
        if (realized > 0) grossWinnings += realized;
        void persistPosition(pos);
      }
      agent.balanceLamports += net;
      void persistAgent(agent);

      await this.executeSettlement(agent, result.fixtureId, net, grossWinnings, open.length, at);
    }
  }

  /**
   * Push net winnings on-chain. Positive net → real devnet transfer from the
   * platform treasury to the agent wallet (reuses settleToAgentWallet). When
   * Solana isn't configured, records an internal-only settlement, mirroring the
   * platform's existing auto-settlement fallback.
   */
  private async executeSettlement(
    agent: ArenaAgent,
    fixtureId: number,
    net: number,
    grossWinnings: number,
    positionsSettled: number,
    at: number
  ): Promise<void> {
    const base: Omit<ArenaSettlementRecord, "txSignature" | "onChain" | "status" | "error"> = {
      id: randomUUID(),
      at,
      fixtureId,
      agentId: agent.id,
      netPnlLamports: net,
      grossWinningsLamports: grossWinnings,
      positionsSettled,
    };

    // Only positive winnings move on-chain; losses settle against bankroll.
    const payout = Math.max(0, net);
    const canChain = isSolanaPayerReady() && payout > 0;

    let rec: ArenaSettlementRecord;
    if (canChain) {
      try {
        const tx = await settleToAgentWallet(agent.walletPubkey, payout);
        rec = { ...base, txSignature: tx, onChain: true, status: "confirmed" };
        // Mirror into the platform's settlements ledger so it shows in receipts.
        await query(
          `INSERT INTO settlements (from_agent_id, to_agent_id, gross_lamports, platform_fee_lamports, net_lamports, tx_signature, status)
           VALUES ($1,$1,$2,0,$2,$3,'confirmed')`,
          [agent.id, payout, tx]
        ).catch(() => {});
        console.log(`[arena] ⛓️  settled ${payout} lamports → ${agent.solName} (tx ${tx})`);
      } catch (err: any) {
        rec = { ...base, txSignature: null, onChain: false, status: "failed", error: (err?.message ?? String(err)).slice(0, 300) };
        console.error(`[arena] on-chain settlement failed for ${agent.id}: ${rec.error}`);
      }
    } else {
      rec = { ...base, txSignature: null, onChain: false, status: "settled_internal" };
      console.log(`[arena] settled ${net} lamports (internal) for ${agent.solName} on fixture ${fixtureId}`);
    }

    this.settlements.unshift(rec);
    if (this.settlements.length > SIGNAL_LOG_CAP) this.settlements.pop();
    void persistSettlement(rec);
  }

  // ---------------------------------------------------------------------------
  // Read API (consumed by routes)
  // ---------------------------------------------------------------------------

  reset(): void {
    this.positions = [];
    this.signals = [];
    this.settlements = [];
    this.tickCount = 0;
    for (const a of this.agents.values()) {
      a.balanceLamports = a.startingBankrollLamports;
    }
  }

  getOverview() {
    const agents = [...this.agents.values()].map((a) => this.agentStats(a));
    return {
      mode: this.feed.mode,
      running: this.running,
      tickCount: this.tickCount,
      lastTickAt: this.feed.getLastTickAt(),
      lastError: this.lastError,
      stakeLamports: STAKE_LAMPORTS,
      config: this.config,
      agents,
      leader: agents.slice().sort((x, y) => y.netPnlLamports - x.netPnlLamports)[0]?.id ?? null,
      openPositions: this.positions.filter((p) => p.status === "open").length,
      totalSettlements: this.settlements.length,
    };
  }

  agentStats(a: ArenaAgent) {
    const all = this.positions.filter((p) => p.agentId === a.id);
    const settled = all.filter((p) => p.status === "settled");
    const open = all.filter((p) => p.status === "open");
    const realized = settled.reduce((s, p) => s + p.realizedPnlLamports, 0);
    const unrealized = open.reduce((s, p) => s + p.unrealizedPnlLamports, 0);
    const wins = settled.filter((p) => p.won).length;
    return {
      id: a.id,
      name: a.name,
      solName: a.solName,
      strategy: a.strategy,
      walletPubkey: a.walletPubkey,
      balanceLamports: a.balanceLamports,
      startingBankrollLamports: a.startingBankrollLamports,
      realizedPnlLamports: realized,
      unrealizedPnlLamports: unrealized,
      netPnlLamports: realized + unrealized,
      equityLamports: a.balanceLamports + unrealized,
      positionsOpen: open.length,
      positionsSettled: settled.length,
      wins,
      losses: settled.length - wins,
      winRate: settled.length ? wins / settled.length : 0,
    };
  }

  getMatches(): MatchSnapshot[] {
    return this.feed.getSnapshots();
  }

  getMatch(fixtureId: number) {
    const snapshot = this.feed.getSnapshot(fixtureId);
    if (!snapshot) return null;
    return {
      snapshot,
      history: this.feed.getHistory(fixtureId),
      positions: this.positions.filter((p) => p.fixtureId === fixtureId),
    };
  }

  getPositions(opts: { status?: "open" | "settled"; agentId?: string } = {}): ArenaPosition[] {
    return this.positions
      .filter((p) => (opts.status ? p.status === opts.status : true))
      .filter((p) => (opts.agentId ? p.agentId === opts.agentId : true))
      .slice()
      .sort((a, b) => b.openedAt - a.openedAt);
  }

  getSignals(limit = 50): ArenaSignalRecord[] {
    return this.signals.slice(0, limit);
  }

  getSettlements(limit = 50): ArenaSettlementRecord[] {
    return this.settlements.slice(0, limit);
  }
}

// Singleton — one arena per process.
let engine: ArenaEngine | null = null;
export function getArena(): ArenaEngine {
  if (!engine) engine = new ArenaEngine();
  return engine;
}
