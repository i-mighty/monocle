/**
 * Anomaly Detection Service
 *
 * Flags suspicious activity patterns:
 * - Sudden spike in tokens (unusual usage increase)
 * - Unusual caller patterns (new callers, behavior changes)
 * - Pricing manipulation (attempts to exploit tool pricing)
 * - Settlement failure loops (repeated failed settlements)
 *
 * Building money rails → abuse prevention is not optional.
 */

import { eq, and, desc, sql, gte, lte, count } from "drizzle-orm";
import { db, pool, agents, toolUsage, settlements, anomalyAlerts, agentBehaviorStats } from "../db/client";
import type { AnomalyAlert, AgentBehaviorStats } from "../db/client";
import { dispatchEvent } from "./webhookService";

// =============================================================================
// TYPES
// =============================================================================

export type AnomalyType =
  | "token_spike"
  | "unusual_caller"
  | "pricing_manipulation"
  | "settlement_loop"
  | "rapid_fire"
  | "new_caller_burst";

export type Severity = "low" | "medium" | "high" | "critical";

export interface AnomalyDetectionResult {
  detected: boolean;
  alerts: AnomalyAlert[];
  autoActions: string[];
}

export interface BehaviorProfile {
  agentId: string;
  hourlyAvgCalls: number;
  hourlyAvgTokens: number;
  dailyAvgCalls: number;
  dailyAvgTokens: number;
  typicalCallers: string[];
  typicalRateRange: { min: number; max: number };
  settlementFailureRate: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const THRESHOLDS = {
  // Token spike: flag if usage exceeds X times the historical average
  TOKEN_SPIKE_MULTIPLIER: 3.0,
  TOKEN_SPIKE_MIN_CALLS: 5, // Need at least this many historical calls

  // Rapid fire: too many calls in short window
  RAPID_FIRE_CALLS_PER_MINUTE: 60,
  RAPID_FIRE_WINDOW_SECONDS: 60,

  // New caller burst: too many new callers in short time
  NEW_CALLER_BURST_COUNT: 10,
  NEW_CALLER_BURST_WINDOW_HOURS: 1,

  // Settlement failure loop: too many consecutive failures
  SETTLEMENT_FAILURE_THRESHOLD: 3,
  SETTLEMENT_FAILURE_WINDOW_HOURS: 24,

  // Pricing manipulation: unusual pricing patterns
  PRICING_DEVIATION_THRESHOLD: 0.5, // 50% deviation from typical

  // Auto-actions
  AUTO_PAUSE_SEVERITY: "critical" as Severity,
  ALERT_RETENTION_DAYS: 90,
};

// =============================================================================
// BEHAVIOR PROFILING
// =============================================================================

/**
 * Build a behavior profile for an agent based on historical data
 */
export async function getBehaviorProfile(agentId: string): Promise<BehaviorProfile> {
  if (!db) throw new Error("Database not connected");

  // Get hourly stats for the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const hourlyStats = await db
    .select()
    .from(agentBehaviorStats)
    .where(
      and(
        eq(agentBehaviorStats.agentId, agentId),
        eq(agentBehaviorStats.windowType, "hourly"),
        gte(agentBehaviorStats.windowStart, sevenDaysAgo)
      )
    );

  const dailyStats = await db
    .select()
    .from(agentBehaviorStats)
    .where(
      and(
        eq(agentBehaviorStats.agentId, agentId),
        eq(agentBehaviorStats.windowType, "daily"),
        gte(agentBehaviorStats.windowStart, sevenDaysAgo)
      )
    );

  // Calculate averages
  const hourlyAvgCalls =
    hourlyStats.length > 0
      ? hourlyStats.reduce((sum, s) => sum + s.totalCalls, 0) / hourlyStats.length
      : 0;
  const hourlyAvgTokens =
    hourlyStats.length > 0
      ? hourlyStats.reduce((sum, s) => sum + s.totalTokens, 0) / hourlyStats.length
      : 0;
  const dailyAvgCalls =
    dailyStats.length > 0
      ? dailyStats.reduce((sum, s) => sum + s.totalCalls, 0) / dailyStats.length
      : 0;
  const dailyAvgTokens =
    dailyStats.length > 0
      ? dailyStats.reduce((sum, s) => sum + s.totalTokens, 0) / dailyStats.length
      : 0;

  // Get typical callers from recent usage
  const recentCallers = await db
    .selectDistinct({ callerId: toolUsage.callerAgentId })
    .from(toolUsage)
    .where(
      and(
        eq(toolUsage.calleeAgentId, agentId),
        gte(toolUsage.createdAt, sevenDaysAgo)
      )
    )
    .limit(100);

  // Get typical rate range
  const rateStats = await db
    .select({
      minRate: sql<number>`MIN(${toolUsage.ratePer1kTokens})`,
      maxRate: sql<number>`MAX(${toolUsage.ratePer1kTokens})`,
    })
    .from(toolUsage)
    .where(
      and(
        eq(toolUsage.calleeAgentId, agentId),
        gte(toolUsage.createdAt, sevenDaysAgo)
      )
    );

  // Get settlement failure rate
  const settlementStats = await db
    .select({
      total: count(),
      failed: sql<number>`SUM(CASE WHEN ${settlements.status} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(settlements)
    .where(
      and(
        eq(settlements.fromAgentId, agentId),
        gte(settlements.createdAt, sevenDaysAgo)
      )
    );

  const totalSettlements = Number(settlementStats[0]?.total || 0);
  const failedSettlements = Number(settlementStats[0]?.failed || 0);
  const settlementFailureRate =
    totalSettlements > 0 ? failedSettlements / totalSettlements : 0;

  return {
    agentId,
    hourlyAvgCalls,
    hourlyAvgTokens,
    dailyAvgCalls,
    dailyAvgTokens,
    typicalCallers: recentCallers.map((c) => c.callerId),
    typicalRateRange: {
      min: rateStats[0]?.minRate || 0,
      max: rateStats[0]?.maxRate || 0,
    },
    settlementFailureRate,
  };
}

/**
 * Update behavior stats for an agent (called after each tool execution)
 */
export async function updateBehaviorStats(
  agentId: string,
  tokensUsed: number,
  costLamports: number,
  callerId: string
): Promise<void> {
  if (!db) throw new Error("Database not connected");

  const now = new Date();

  // Update hourly stats
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);

  await db
    .insert(agentBehaviorStats)
    .values({
      agentId,
      windowType: "hourly",
      windowStart: hourStart,
      totalCalls: 1,
      totalTokens: tokensUsed,
      totalCostLamports: costLamports,
      uniqueCallers: 1,
      avgTokensPerCall: tokensUsed,
      maxTokensInCall: tokensUsed,
      avgCostPerCall: costLamports,
    })
    .onConflictDoUpdate({
      target: [agentBehaviorStats.agentId, agentBehaviorStats.windowType, agentBehaviorStats.windowStart],
      set: {
        totalCalls: sql`${agentBehaviorStats.totalCalls} + 1`,
        totalTokens: sql`${agentBehaviorStats.totalTokens} + ${tokensUsed}`,
        totalCostLamports: sql`${agentBehaviorStats.totalCostLamports} + ${costLamports}`,
        avgTokensPerCall: sql`(${agentBehaviorStats.totalTokens} + ${tokensUsed}) / (${agentBehaviorStats.totalCalls} + 1)`,
        maxTokensInCall: sql`GREATEST(${agentBehaviorStats.maxTokensInCall}, ${tokensUsed})`,
        avgCostPerCall: sql`(${agentBehaviorStats.totalCostLamports} + ${costLamports}) / (${agentBehaviorStats.totalCalls} + 1)`,
      },
    });

  // Update daily stats
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  await db
    .insert(agentBehaviorStats)
    .values({
      agentId,
      windowType: "daily",
      windowStart: dayStart,
      totalCalls: 1,
      totalTokens: tokensUsed,
      totalCostLamports: costLamports,
      uniqueCallers: 1,
      avgTokensPerCall: tokensUsed,
      maxTokensInCall: tokensUsed,
      avgCostPerCall: costLamports,
    })
    .onConflictDoUpdate({
      target: [agentBehaviorStats.agentId, agentBehaviorStats.windowType, agentBehaviorStats.windowStart],
      set: {
        totalCalls: sql`${agentBehaviorStats.totalCalls} + 1`,
        totalTokens: sql`${agentBehaviorStats.totalTokens} + ${tokensUsed}`,
        totalCostLamports: sql`${agentBehaviorStats.totalCostLamports} + ${costLamports}`,
        avgTokensPerCall: sql`(${agentBehaviorStats.totalTokens} + ${tokensUsed}) / (${agentBehaviorStats.totalCalls} + 1)`,
        maxTokensInCall: sql`GREATEST(${agentBehaviorStats.maxTokensInCall}, ${tokensUsed})`,
        avgCostPerCall: sql`(${agentBehaviorStats.totalCostLamports} + ${costLamports}) / (${agentBehaviorStats.totalCalls} + 1)`,
      },
    });
}

// =============================================================================
// ANOMALY DETECTION
// =============================================================================

/**
 * Run all anomaly detection checks for an execution
 */
export async function detectAnomalies(
  callerId: string,
  calleeId: string,
  toolName: string,
  tokensUsed: number,
  ratePer1kTokens: number
): Promise<AnomalyDetectionResult> {
  const alerts: AnomalyAlert[] = [];
  const autoActions: string[] = [];

  // Get behavior profile for the callee (provider)
  const profile = await getBehaviorProfile(calleeId);

  // 1. Check for token spike
  const tokenSpikeAlert = await detectTokenSpike(calleeId, tokensUsed, profile);
  if (tokenSpikeAlert) alerts.push(tokenSpikeAlert);

  // 2. Check for unusual caller
  const callerAlert = await detectUnusualCaller(calleeId, callerId, profile);
  if (callerAlert) alerts.push(callerAlert);

  // 3. Check for pricing manipulation
  const pricingAlert = await detectPricingManipulation(
    calleeId,
    ratePer1kTokens,
    profile
  );
  if (pricingAlert) alerts.push(pricingAlert);

  // 4. Check for rapid fire (requires checking recent calls)
  const rapidFireAlert = await detectRapidFire(callerId, calleeId);
  if (rapidFireAlert) alerts.push(rapidFireAlert);

  // Execute auto-actions for critical alerts
  for (const alert of alerts) {
    if (alert.severity === THRESHOLDS.AUTO_PAUSE_SEVERITY) {
      // Auto-pause the agent for critical alerts
      await autoPauseAgent(alert.agentId, alert.id);
      autoActions.push(`Auto-paused agent ${alert.agentId}`);
    }

    // Send webhook notification
    try {
      await dispatchEvent(alert.agentId, "anomaly_detected", {
        alertId: alert.id,
        alertType: alert.alertType,
        severity: alert.severity,
        description: alert.description,
      });
    } catch (e) {
      // Don't fail the request if webhook fails
      console.error("Failed to dispatch anomaly webhook:", e);
    }
  }

  return {
    detected: alerts.length > 0,
    alerts,
    autoActions,
  };
}

/**
 * Detect sudden spike in token usage
 */
async function detectTokenSpike(
  agentId: string,
  tokensUsed: number,
  profile: BehaviorProfile
): Promise<AnomalyAlert | null> {
  if (!db) return null;

  // Need minimum history to detect spikes
  if (profile.hourlyAvgTokens === 0) return null;

  const multiplier = tokensUsed / profile.hourlyAvgTokens;

  if (multiplier >= THRESHOLDS.TOKEN_SPIKE_MULTIPLIER) {
    const alert = await createAlert({
      agentId,
      alertType: "token_spike",
      severity: multiplier >= 10 ? "critical" : multiplier >= 5 ? "high" : "medium",
      description: `Token usage spike detected: ${tokensUsed} tokens is ${multiplier.toFixed(1)}x the hourly average of ${Math.round(profile.hourlyAvgTokens)}`,
      detectedValue: JSON.stringify({ tokensUsed, multiplier }),
      expectedRange: JSON.stringify({
        avgHourly: profile.hourlyAvgTokens,
        threshold: THRESHOLDS.TOKEN_SPIKE_MULTIPLIER,
      }),
      confidence: Math.min(95, Math.round(60 + multiplier * 5)),
    });

    return alert;
  }

  return null;
}

/**
 * Detect unusual caller patterns
 */
async function detectUnusualCaller(
  agentId: string,
  callerId: string,
  profile: BehaviorProfile
): Promise<AnomalyAlert | null> {
  if (!db) return null;

  // Check if caller is new (not in typical callers)
  const isNewCaller = !profile.typicalCallers.includes(callerId);

  if (!isNewCaller) return null;

  // Check for burst of new callers in short time
  const oneHourAgo = new Date(Date.now() - THRESHOLDS.NEW_CALLER_BURST_WINDOW_HOURS * 60 * 60 * 1000);

  const recentNewCallers = await db
    .selectDistinct({ callerId: toolUsage.callerAgentId })
    .from(toolUsage)
    .where(
      and(
        eq(toolUsage.calleeAgentId, agentId),
        gte(toolUsage.createdAt, oneHourAgo)
      )
    );

  const newCallersCount = recentNewCallers.filter(
    (c) => !profile.typicalCallers.includes(c.callerId)
  ).length;

  if (newCallersCount >= THRESHOLDS.NEW_CALLER_BURST_COUNT) {
    const alert = await createAlert({
      agentId,
      alertType: "new_caller_burst",
      severity: "high",
      description: `Burst of ${newCallersCount} new callers detected in the last hour. This may indicate a coordinated attack.`,
      detectedValue: JSON.stringify({ newCallersCount, callerId }),
      expectedRange: JSON.stringify({
        typicalCallersCount: profile.typicalCallers.length,
        threshold: THRESHOLDS.NEW_CALLER_BURST_COUNT,
      }),
      relatedCallerId: callerId,
      confidence: 75,
    });

    return alert;
  }

  // Single new caller is just informational
  return null;
}

/**
 * Detect pricing manipulation attempts
 */
async function detectPricingManipulation(
  agentId: string,
  ratePer1kTokens: number,
  profile: BehaviorProfile
): Promise<AnomalyAlert | null> {
  if (!db) return null;

  // Need rate history to detect manipulation
  if (profile.typicalRateRange.max === 0) return null;

  const avgRate = (profile.typicalRateRange.min + profile.typicalRateRange.max) / 2;
  const deviation = Math.abs(ratePer1kTokens - avgRate) / avgRate;

  if (deviation >= THRESHOLDS.PRICING_DEVIATION_THRESHOLD) {
    const alert = await createAlert({
      agentId,
      alertType: "pricing_manipulation",
      severity: deviation >= 1.0 ? "high" : "medium",
      description: `Unusual pricing detected: ${ratePer1kTokens} lamports/1k tokens deviates ${(deviation * 100).toFixed(0)}% from typical range (${profile.typicalRateRange.min}-${profile.typicalRateRange.max})`,
      detectedValue: JSON.stringify({ ratePer1kTokens, deviation }),
      expectedRange: JSON.stringify(profile.typicalRateRange),
      confidence: Math.min(90, Math.round(50 + deviation * 40)),
    });

    return alert;
  }

  return null;
}

/**
 * Detect rapid-fire requests (potential DoS)
 */
async function detectRapidFire(
  callerId: string,
  calleeId: string
): Promise<AnomalyAlert | null> {
  if (!db) return null;

  const windowStart = new Date(
    Date.now() - THRESHOLDS.RAPID_FIRE_WINDOW_SECONDS * 1000
  );

  const recentCalls = await db
    .select({ count: count() })
    .from(toolUsage)
    .where(
      and(
        eq(toolUsage.callerAgentId, callerId),
        eq(toolUsage.calleeAgentId, calleeId),
        gte(toolUsage.createdAt, windowStart)
      )
    );

  const callCount = Number(recentCalls[0]?.count || 0);

  if (callCount >= THRESHOLDS.RAPID_FIRE_CALLS_PER_MINUTE) {
    const alert = await createAlert({
      agentId: calleeId,
      alertType: "rapid_fire",
      severity: "critical",
      description: `Rapid-fire attack detected: ${callCount} calls from ${callerId} in the last ${THRESHOLDS.RAPID_FIRE_WINDOW_SECONDS} seconds`,
      detectedValue: JSON.stringify({ callCount, callerId }),
      expectedRange: JSON.stringify({
        threshold: THRESHOLDS.RAPID_FIRE_CALLS_PER_MINUTE,
        windowSeconds: THRESHOLDS.RAPID_FIRE_WINDOW_SECONDS,
      }),
      relatedCallerId: callerId,
      confidence: 95,
    });

    return alert;
  }

  return null;
}

/**
 * Detect settlement failure loops
 */
export async function detectSettlementFailureLoop(
  agentId: string
): Promise<AnomalyAlert | null> {
  if (!db) return null;

  const windowStart = new Date(
    Date.now() - THRESHOLDS.SETTLEMENT_FAILURE_WINDOW_HOURS * 60 * 60 * 1000
  );

  const recentFailures = await db
    .select({ count: count() })
    .from(settlements)
    .where(
      and(
        eq(settlements.fromAgentId, agentId),
        eq(settlements.status, "failed"),
        gte(settlements.createdAt, windowStart)
      )
    );

  const failureCount = Number(recentFailures[0]?.count || 0);

  if (failureCount >= THRESHOLDS.SETTLEMENT_FAILURE_THRESHOLD) {
    const alert = await createAlert({
      agentId,
      alertType: "settlement_loop",
      severity: "high",
      description: `Settlement failure loop detected: ${failureCount} failed settlements in the last ${THRESHOLDS.SETTLEMENT_FAILURE_WINDOW_HOURS} hours. Check wallet balance and network connectivity.`,
      detectedValue: JSON.stringify({ failureCount }),
      expectedRange: JSON.stringify({
        threshold: THRESHOLDS.SETTLEMENT_FAILURE_THRESHOLD,
        windowHours: THRESHOLDS.SETTLEMENT_FAILURE_WINDOW_HOURS,
      }),
      confidence: 90,
    });

    return alert;
  }

  return null;
}

// =============================================================================
// ALERT MANAGEMENT
// =============================================================================

/**
 * Create a new anomaly alert
 */
async function createAlert(params: {
  agentId: string;
  alertType: AnomalyType;
  severity: Severity;
  description: string;
  detectedValue?: string;
  expectedRange?: string;
  relatedCallerId?: string;
  relatedToolName?: string;
  confidence?: number;
}): Promise<AnomalyAlert> {
  if (!db) throw new Error("Database not connected");

  const now = new Date();

  const result = await db
    .insert(anomalyAlerts)
    .values({
      agentId: params.agentId,
      alertType: params.alertType,
      severity: params.severity,
      description: params.description,
      detectedValue: params.detectedValue,
      expectedRange: params.expectedRange,
      relatedCallerId: params.relatedCallerId,
      relatedToolName: params.relatedToolName,
      confidence: params.confidence || 80,
      windowEnd: now,
    })
    .returning();

  return result[0];
}

/**
 * Auto-pause an agent due to critical alert
 */
async function autoPauseAgent(agentId: string, alertId: string): Promise<void> {
  if (!db) throw new Error("Database not connected");

  // Pause the agent
  await db
    .update(agents)
    .set({ isPaused: "true" })
    .where(eq(agents.id, agentId));

  // Update alert with action taken
  await db
    .update(anomalyAlerts)
    .set({
      actionsTaken: JSON.stringify(["auto_paused"]),
      updatedAt: new Date(),
    })
    .where(eq(anomalyAlerts.id, alertId));
}

/**
 * Get alerts for an agent
 */
export async function getAlerts(
  agentId: string,
  options?: {
    status?: string;
    severity?: Severity;
    limit?: number;
  }
): Promise<AnomalyAlert[]> {
  if (!db) throw new Error("Database not connected");

  let query = db
    .select()
    .from(anomalyAlerts)
    .where(eq(anomalyAlerts.agentId, agentId))
    .orderBy(desc(anomalyAlerts.createdAt))
    .limit(options?.limit || 100);

  // TODO: Add filtering by status and severity

  return query;
}

/**
 * Resolve an alert
 */
export async function resolveAlert(
  alertId: string,
  resolution: { status: "resolved" | "false_positive"; notes?: string }
): Promise<AnomalyAlert> {
  if (!db) throw new Error("Database not connected");

  const result = await db
    .update(anomalyAlerts)
    .set({
      status: resolution.status,
      resolvedAt: new Date(),
      resolutionNotes: resolution.notes,
      updatedAt: new Date(),
    })
    .where(eq(anomalyAlerts.id, alertId))
    .returning();

  if (result.length === 0) {
    throw new Error(`Alert not found: ${alertId}`);
  }

  return result[0];
}

/**
 * Get platform-wide anomaly summary
 */
export async function getPlatformAnomalySummary(): Promise<{
  totalAlerts: number;
  openAlerts: number;
  criticalAlerts: number;
  alertsByType: Record<string, number>;
  recentAlerts: AnomalyAlert[];
}> {
  if (!db) throw new Error("Database not connected");

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get counts
  const stats = await db
    .select({
      total: count(),
      open: sql<number>`SUM(CASE WHEN ${anomalyAlerts.status} = 'open' THEN 1 ELSE 0 END)`,
      critical: sql<number>`SUM(CASE WHEN ${anomalyAlerts.severity} = 'critical' THEN 1 ELSE 0 END)`,
    })
    .from(anomalyAlerts)
    .where(gte(anomalyAlerts.createdAt, oneDayAgo));

  // Get counts by type
  const byType = await db
    .select({
      type: anomalyAlerts.alertType,
      count: count(),
    })
    .from(anomalyAlerts)
    .where(gte(anomalyAlerts.createdAt, oneDayAgo))
    .groupBy(anomalyAlerts.alertType);

  // Get recent alerts
  const recentAlerts = await db
    .select()
    .from(anomalyAlerts)
    .where(gte(anomalyAlerts.createdAt, oneDayAgo))
    .orderBy(desc(anomalyAlerts.createdAt))
    .limit(10);

  const alertsByType: Record<string, number> = {};
  for (const row of byType) {
    alertsByType[row.type] = Number(row.count);
  }

  return {
    totalAlerts: Number(stats[0]?.total || 0),
    openAlerts: Number(stats[0]?.open || 0),
    criticalAlerts: Number(stats[0]?.critical || 0),
    alertsByType,
    recentAlerts,
  };
}
