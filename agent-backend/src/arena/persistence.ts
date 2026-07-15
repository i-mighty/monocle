/**
 * Best-effort persistence for the Arena.
 *
 * The engine keeps authoritative state in memory so it runs with zero infra
 * (great for the demo). When DATABASE_URL is configured and the arena_* tables
 * exist, we also append an auditable trail. Every write is wrapped so a missing
 * table or transient DB error never interrupts the autonomous loop.
 */

import { query, pool } from "../db/client";
import { ArenaAgent, ArenaPosition, ArenaSettlementRecord, ArenaSignalRecord } from "./types";

export const persistenceEnabled = (): boolean => !!pool;

async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  if (!pool) return;
  try {
    await fn();
  } catch (err: any) {
    // Downgrade to a single warning — never throw into the engine loop.
    console.warn(`[arena] persist ${label} skipped: ${err?.message ?? err}`);
  }
}

export async function persistAgent(a: ArenaAgent): Promise<void> {
  await safe("agent", () =>
    query(
      `INSERT INTO arena_agents (id, name, sol_name, strategy, wallet_pubkey, starting_bankroll_lamports, balance_lamports)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET balance_lamports = EXCLUDED.balance_lamports, updated_at = now()`,
      [a.id, a.name, a.solName, a.strategy, a.walletPubkey, a.startingBankrollLamports, a.balanceLamports]
    )
  );
}

export async function persistSignal(s: ArenaSignalRecord): Promise<void> {
  await safe("signal", () =>
    query(
      `INSERT INTO arena_signals (id, strategy, fixture_id, selection, entry_prob, move, confidence, reason, acted, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_timestamp($10/1000.0))`,
      [s.id, s.strategy, s.fixtureId, s.selection, s.entryProb, s.move, s.confidence, s.reason, s.acted, s.at]
    )
  );
}

export async function persistPosition(p: ArenaPosition): Promise<void> {
  await safe("position", () =>
    query(
      `INSERT INTO arena_positions
         (id, agent_id, strategy, fixture_id, selection, stake_lamports, entry_prob, entry_odds, shares,
          status, mark_prob, unrealized_pnl_lamports, realized_pnl_lamports, won, reason, confidence, opened_at, settled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, to_timestamp($17/1000.0), $18)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         mark_prob = EXCLUDED.mark_prob,
         unrealized_pnl_lamports = EXCLUDED.unrealized_pnl_lamports,
         realized_pnl_lamports = EXCLUDED.realized_pnl_lamports,
         won = EXCLUDED.won,
         settled_at = EXCLUDED.settled_at`,
      [
        p.id, p.agentId, p.strategy, p.fixtureId, p.selection, p.stakeLamports, p.entryProb, p.entryOdds, p.shares,
        p.status, p.markProb, p.unrealizedPnlLamports, p.realizedPnlLamports, p.won, p.reason, p.confidence,
        p.openedAt, p.settledAt ? new Date(p.settledAt) : null,
      ]
    )
  );
}

export async function persistSettlement(s: ArenaSettlementRecord): Promise<void> {
  await safe("settlement", () =>
    query(
      `INSERT INTO arena_settlements
         (id, fixture_id, agent_id, net_pnl_lamports, gross_winnings_lamports, positions_settled, tx_signature, on_chain, status, error, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, to_timestamp($11/1000.0))`,
      [s.id, s.fixtureId, s.agentId, s.netPnlLamports, s.grossWinningsLamports, s.positionsSettled, s.txSignature, s.onChain, s.status, s.error ?? null, s.at]
    )
  );
}
