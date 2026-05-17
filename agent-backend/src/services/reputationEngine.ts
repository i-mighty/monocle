/**
 * Reputation engine — turns the static `agents.reputation_score` column
 * into a real signal derived from on-platform behaviour. Distinct from
 * reputationService.ts (which exposes drizzle-backed metrics) — this one
 * is the periodic compute that updates the score column itself.
 *
 * Score is 0..1000 with 500 as the neutral baseline. Components:
 *
 *   - SuccessRate30d   (heaviest weight): of reported calls in the last
 *                       30 days, fraction that succeeded.
 *   - EndpointUptime   : successful_checks / total_checks from the
 *                       agent_endpoints health pinger.
 *   - SettlementOk     : confirmed settlements / (confirmed + failed).
 *   - TenureBonus      : small bonus for agents that have been on the
 *                       platform a while (max +60 at 6 months).
 *   - RecentActivity   : small bonus if active in last 7 days.
 *
 * Missing data → no contribution (not a penalty). A brand new agent with
 * nothing recorded stays at the 500 baseline.
 *
 * Decay: implicit. The 30-day rolling window means old wins fade.
 */

import { query } from "../db/client";

export interface ReputationBreakdown {
  agentId: string;
  score: number;
  baseline: number;
  components: {
    successRate30d: { value: number | null; sampleSize: number; contribution: number };
    endpointUptime: { value: number | null; sampleSize: number; contribution: number };
    settlementOk: { value: number | null; sampleSize: number; contribution: number };
    tenureBonus: { ageDays: number; contribution: number };
    recentActivity: { callsLast7d: number; contribution: number };
  };
  computedAt: string;
}

const BASELINE = 500;
const MIN_SCORE = 0;
const MAX_SCORE = 1000;

// Weights tuned so the heaviest signal does actual work, not just nudges
// at the edges. SuccessRate dominates by design — that's the moat.
const W_SUCCESS = 300;   // ±300 swing
const W_UPTIME = 120;    // ±120 swing
const W_SETTLEMENT = 80; // ±80 swing
const MAX_TENURE_BONUS = 60;
const RECENT_ACTIVITY_BONUS = 40;

// Sample-size damping: with < 5 data points a signal is too noisy to fully
// trust. Damp the contribution proportionally.
const MIN_SAMPLE_FOR_FULL_WEIGHT = 5;

function sampleDamp(sampleSize: number): number {
  if (sampleSize === 0) return 0;
  if (sampleSize >= MIN_SAMPLE_FOR_FULL_WEIGHT) return 1;
  return sampleSize / MIN_SAMPLE_FOR_FULL_WEIGHT;
}

/**
 * Compute a reputation breakdown for one agent. Reads only — doesn't write.
 * Use recomputeAgentReputation() if you also want to persist.
 */
export async function computeAgentReputation(agentId: string): Promise<ReputationBreakdown | null> {
  const agentRow = await query(
    "select id, created_at from agents where id = $1",
    [agentId]
  );
  if (agentRow.rows.length === 0) return null;
  const createdAt = new Date(agentRow.rows[0].created_at).getTime();
  const ageDays = Math.max(0, (Date.now() - createdAt) / 86_400_000);

  // ---- SuccessRate30d ----
  const succRes = await query(
    `select
       count(*) filter (where success is not null) as reported,
       count(*) filter (where success = true) as ok
     from tool_usage
     where callee_agent_id = $1
       and created_at > now() - interval '30 days'`,
    [agentId]
  );
  const reported = Number(succRes.rows[0]?.reported) || 0;
  const ok = Number(succRes.rows[0]?.ok) || 0;
  const successRate = reported > 0 ? ok / reported : null;
  // 100% → +W_SUCCESS, 50% → 0, 0% → -W_SUCCESS
  const successContrib = Math.round(
    successRate === null ? 0 : (successRate - 0.5) * 2 * W_SUCCESS * sampleDamp(reported)
  );

  // ---- EndpointUptime ----
  const epRes = await query(
    `select successful_checks, total_checks
     from agent_endpoints where agent_id = $1`,
    [agentId]
  );
  const totalChecks = Number(epRes.rows[0]?.total_checks) || 0;
  const successfulChecks = Number(epRes.rows[0]?.successful_checks) || 0;
  const uptime = totalChecks > 0 ? successfulChecks / totalChecks : null;
  // 100% → +W_UPTIME, 80% → 0, <80% trends negative. Multiplier 5 maps the
  // narrow 80–100% band to the full weight range.
  const uptimeContrib = Math.round(
    uptime === null ? 0 : (uptime - 0.8) * 5 * W_UPTIME * sampleDamp(totalChecks)
  );

  // ---- SettlementOk ----
  const setRes = await query(
    `select
       count(*) filter (where status in ('confirmed', 'settled_internal')) as ok,
       count(*) filter (where status in ('confirmed', 'settled_internal', 'failed')) as attempted
     from settlements
     where to_agent_id = $1`,
    [agentId]
  );
  const settlementAttempted = Number(setRes.rows[0]?.attempted) || 0;
  const settlementOk = Number(setRes.rows[0]?.ok) || 0;
  const settlementRate = settlementAttempted > 0 ? settlementOk / settlementAttempted : null;
  const settlementContrib = Math.round(
    settlementRate === null ? 0 : (settlementRate - 0.5) * 2 * W_SETTLEMENT * sampleDamp(settlementAttempted)
  );

  // ---- TenureBonus ----
  // Linear from 0 → MAX_TENURE_BONUS over 180 days, then capped.
  const tenureBonus = Math.round(Math.min(ageDays / 180, 1) * MAX_TENURE_BONUS);

  // ---- RecentActivity ----
  const recentRes = await query(
    `select count(*) as n from tool_usage
     where callee_agent_id = $1 and created_at > now() - interval '7 days'`,
    [agentId]
  );
  const callsLast7d = Number(recentRes.rows[0]?.n) || 0;
  const recentActivity = callsLast7d > 0 ? RECENT_ACTIVITY_BONUS : 0;

  const raw = BASELINE + successContrib + uptimeContrib + settlementContrib + tenureBonus + recentActivity;
  const score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(raw)));

  return {
    agentId,
    score,
    baseline: BASELINE,
    components: {
      successRate30d: { value: successRate, sampleSize: reported, contribution: successContrib },
      endpointUptime: { value: uptime, sampleSize: totalChecks, contribution: uptimeContrib },
      settlementOk: { value: settlementRate, sampleSize: settlementAttempted, contribution: settlementContrib },
      tenureBonus: { ageDays: Math.round(ageDays * 10) / 10, contribution: tenureBonus },
      recentActivity: { callsLast7d, contribution: recentActivity },
    },
    computedAt: new Date().toISOString(),
  };
}

/** Persist the score back to the agents row. */
export async function writeReputationScore(agentId: string, score: number): Promise<void> {
  await query(
    "update agents set reputation_score = $2, updated_at = now() where id = $1",
    [agentId, score]
  );
}

/** Recompute + persist for one agent. Returns the breakdown. */
export async function recomputeAgentReputation(agentId: string): Promise<ReputationBreakdown | null> {
  const breakdown = await computeAgentReputation(agentId);
  if (!breakdown) return null;
  await writeReputationScore(agentId, breakdown.score);
  return breakdown;
}

/** Recompute every agent's reputation. Called by the periodic scheduler. */
export async function recomputeAllReputations(): Promise<{ updated: number; durationMs: number }> {
  const started = Date.now();
  const ids = await query("select id from agents", []);
  let updated = 0;
  for (const row of ids.rows) {
    try {
      await recomputeAgentReputation(row.id);
      updated++;
    } catch (err) {
      console.error(`[Reputation] Failed to recompute for ${row.id}:`, err);
    }
  }
  return { updated, durationMs: Date.now() - started };
}
