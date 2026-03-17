/**
 * Agent Registry Service
 *
 * Enhanced agent registry operations for:
 * - Profile management (bio, categories, URLs)
 * - Reputation score tracking
 * - Verification/audit management
 * - Version history tracking
 * - Capability declarations
 * - Tool metadata management
 */

import { query } from "../db/client";
import { v4 as uuidv4 } from "uuid";

// =============================================================================
// TYPES
// =============================================================================

export interface AgentProfile {
  agentId: string;
  name?: string;
  bio?: string;
  websiteUrl?: string;
  logoUrl?: string;
  categories?: string[];
  version?: string;
  ownerEmail?: string;
  supportUrl?: string;
}

export interface AgentAudit {
  id: string;
  agentId: string;
  auditType: string;
  result: string;
  auditorId?: string;
  auditorName?: string;
  auditorType: string;
  summary?: string;
  detailsJson?: any;
  evidenceUrl?: string;
  certificateHash?: string;
  validFrom: string;
  validUntil?: string;
  score?: number;
  notes?: string;
  createdAt: string;
}

export interface AgentCapability {
  id: string;
  agentId: string;
  capability: string;
  proficiencyLevel: string;
  isVerified: boolean;
  verifiedAt?: string;
  metadata?: any;
  createdAt: string;
}

export interface VersionHistoryEntry {
  id: string;
  agentId: string;
  version: string;
  changeType: string;
  snapshotJson: any;
  changesJson?: any;
  changedBy?: string;
  changeReason?: string;
  isBreakingChange: boolean;
  migrationNotes?: string;
  createdAt: string;
}

export interface ToolMetadata {
  id: string;
  agentId: string;
  name: string;
  description?: string;
  version: string;
  category?: string;
  inputSchema?: any;
  outputSchema?: any;
  examplesJson?: any[];
  avgTokensPerCall?: number;
  maxTokensPerCall?: number;
  docsUrl?: string;
  isDeprecated: boolean;
  deprecationMessage?: string;
  totalCalls: number;
  totalTokensProcessed: number;
  lastCalledAt?: string;
  ratePer1kTokens: number;
  isActive: boolean;
}

// =============================================================================
// PROFILE MANAGEMENT
// =============================================================================

/**
 * Update agent profile information
 */
export async function updateAgentProfile(
  agentId: string,
  profile: Partial<AgentProfile>
): Promise<{ success: boolean; agent?: any; error?: string }> {
  try {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (profile.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(profile.name);
    }
    if (profile.bio !== undefined) {
      updates.push(`bio = $${paramIndex++}`);
      values.push(profile.bio);
    }
    if (profile.websiteUrl !== undefined) {
      updates.push(`website_url = $${paramIndex++}`);
      values.push(profile.websiteUrl);
    }
    if (profile.logoUrl !== undefined) {
      updates.push(`logo_url = $${paramIndex++}`);
      values.push(profile.logoUrl);
    }
    if (profile.categories !== undefined) {
      updates.push(`categories = $${paramIndex++}`);
      values.push(JSON.stringify(profile.categories));
    }
    if (profile.version !== undefined) {
      updates.push(`version = $${paramIndex++}`);
      values.push(profile.version);
    }
    if (profile.ownerEmail !== undefined) {
      updates.push(`owner_email = $${paramIndex++}`);
      values.push(profile.ownerEmail);
    }
    if (profile.supportUrl !== undefined) {
      updates.push(`support_url = $${paramIndex++}`);
      values.push(profile.supportUrl);
    }

    if (updates.length === 0) {
      return { success: false, error: "No fields to update" };
    }

    updates.push(`updated_at = now()`);
    values.push(agentId);

    const result = await query(
      `UPDATE agents SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return { success: false, error: "Agent not found" };
    }

    return { success: true, agent: formatAgentRow(result.rows[0]) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get full agent profile with all registry enhancements
 */
export async function getAgentFullProfile(
  agentId: string
): Promise<{
  success: boolean;
  profile?: any;
  tools?: ToolMetadata[];
  audits?: AgentAudit[];
  capabilities?: AgentCapability[];
  versionHistory?: VersionHistoryEntry[];
  error?: string;
}> {
  try {
    // Get agent profile
    const agentResult = await query(
      `SELECT * FROM agents WHERE id = $1`,
      [agentId]
    );

    if (agentResult.rows.length === 0) {
      return { success: false, error: "Agent not found" };
    }

    const profile = formatAgentRow(agentResult.rows[0]);

    // Get tools
    const toolsResult = await query(
      `SELECT * FROM tools WHERE agent_id = $1 ORDER BY name`,
      [agentId]
    );
    const tools = toolsResult.rows.map(formatToolRow);

    // Get audits
    const auditsResult = await query(
      `SELECT * FROM agent_audits WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [agentId]
    );
    const audits = auditsResult.rows.map(formatAuditRow);

    // Get capabilities
    const capabilitiesResult = await query(
      `SELECT * FROM agent_capabilities WHERE agent_id = $1 ORDER BY capability`,
      [agentId]
    );
    const capabilities = capabilitiesResult.rows.map(formatCapabilityRow);

    // Get recent version history
    const historyResult = await query(
      `SELECT * FROM agent_version_history WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [agentId]
    );
    const versionHistory = historyResult.rows.map(formatVersionHistoryRow);

    return {
      success: true,
      profile,
      tools,
      audits,
      capabilities,
      versionHistory,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// REPUTATION MANAGEMENT
// =============================================================================

/**
 * Update agent reputation score
 * Score is 0-1000, higher is better
 */
export async function updateReputationScore(
  agentId: string,
  score: number,
  reason?: string
): Promise<{ success: boolean; previousScore?: number; newScore?: number; error?: string }> {
  try {
    // Clamp score to valid range
    const clampedScore = Math.max(0, Math.min(1000, Math.round(score)));

    // Get current score
    const current = await query(
      `SELECT reputation_score, version FROM agents WHERE id = $1`,
      [agentId]
    );

    if (current.rows.length === 0) {
      return { success: false, error: "Agent not found" };
    }

    const previousScore = current.rows[0].reputation_score;

    // Update score
    await query(
      `UPDATE agents SET reputation_score = $1, updated_at = now() WHERE id = $2`,
      [clampedScore, agentId]
    );

    // Log version history
    await recordVersionHistory(agentId, current.rows[0].version, "reputation_change", {
      previousScore,
      newScore: clampedScore,
      reason,
    });

    return { success: true, previousScore, newScore: clampedScore };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Calculate reputation score based on observable performance metrics
 *
 * REPUTATION FORMULA (0-1000 scale):
 * ---------------------------------
 * SUCCESS_RATE  (50%): success_count / total_requests * 500
 * UPTIME        (25%): days_with_successful_requests / total_active_days * 250
 * SPEED         (15%): percentile rank by avg latency * 150 (faster = higher)
 * LONGEVITY     (10%): min(days_since_registration / 365, 1) * 100
 *
 * BONUSES:
 * - Verified status: +50
 * - Passed security audit: +50
 *
 * PENALTIES:
 * - Consecutive health check failures: -10 per failure (max -100)
 * - Recent errors (last 24h): -5 per error (max -50)
 *
 * Minimum score: 0, Maximum score: 1000
 */
export const REPUTATION_FORMULA = {
  weights: {
    successRate: 0.50,      // 50% weight
    uptime: 0.25,           // 25% weight
    speed: 0.15,            // 15% weight
    longevity: 0.10,        // 10% weight
  },
  bonuses: {
    verified: 50,
    securityAudit: 50,
  },
  penalties: {
    healthCheckFailure: -10,  // per consecutive failure
    maxHealthPenalty: -100,
    recentError: -5,          // per error in last 24h
    maxErrorPenalty: -50,
  },
  maxScore: 1000,
  baseScore: 500,  // New agents start here
  // Cold start protection: new agents get provisional score
  provisionalScore: 500,
  provisionalRequestThreshold: 50,  // Requests before full scoring applies
};

export async function calculateReputationScore(agentId: string): Promise<{
  success: boolean;
  score?: number;
  factors?: {
    successRate: { value: number; score: number; weight: string };
    uptime: { value: number; score: number; weight: string };
    speed: { value: number; percentile: number; score: number; weight: string };
    longevity: { value: number; score: number; weight: string };
    bonuses: { verified: number; audit: number };
    penalties: { healthCheck: number; recentErrors: number };
    provisional?: {
      isProvisional: boolean;
      requestsUntilFull: number;
      blendWeight?: number;
      baseScore: number;
      calculatedScore: number;
    };
    total: number;
    formula: string;
  };
  error?: string;
}> {
  try {
    // Get agent basic info
    const agentResult = await query(
      `SELECT verified_status, created_at FROM agents WHERE id = $1`,
      [agentId]
    );

    if (agentResult.rows.length === 0) {
      return { success: false, error: "Agent not found" };
    }

    const agent = agentResult.rows[0];
    const ageInDays = Math.max(1, Math.floor(
      (Date.now() - new Date(agent.created_at).getTime()) / (1000 * 60 * 60 * 24)
    ));

    // Get performance metrics from request_logs (last 90 days)
    const perfResult = await query(
      `SELECT 
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE success = true) as success_count,
        AVG(latency_ms) FILTER (WHERE success = true) as avg_latency_ms,
        COUNT(DISTINCT DATE(created_at)) as active_days,
        COUNT(DISTINCT DATE(created_at)) FILTER (WHERE success = true) as successful_days
       FROM request_logs 
       WHERE selected_agent_id = $1 
       AND created_at > NOW() - INTERVAL '90 days'`,
      [agentId]
    );

    const perf = perfResult.rows[0];
    const totalRequests = Number(perf.total_requests) || 0;
    const successCount = Number(perf.success_count) || 0;
    const avgLatencyMs = Number(perf.avg_latency_ms) || 1000;
    const activeDays = Number(perf.active_days) || 1;
    const successfulDays = Number(perf.successful_days) || 0;

    // Get recent errors (last 24h)
    const recentErrorsResult = await query(
      `SELECT COUNT(*) as error_count
       FROM request_logs
       WHERE selected_agent_id = $1
       AND success = false
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [agentId]
    );
    const recentErrors = Number(recentErrorsResult.rows[0]?.error_count) || 0;

    // Get health check status
    const healthResult = await query(
      `SELECT consecutive_failures FROM agent_endpoints WHERE agent_id = $1`,
      [agentId]
    ).catch(() => ({ rows: [{ consecutive_failures: 0 }] }));
    const consecutiveFailures = Number(healthResult.rows[0]?.consecutive_failures) || 0;

    // Get speed percentile (compare to all agents)
    const speedPercentileResult = await query(
      `WITH agent_speeds AS (
        SELECT selected_agent_id, AVG(latency_ms) as avg_latency
        FROM request_logs
        WHERE success = true AND created_at > NOW() - INTERVAL '90 days'
        GROUP BY selected_agent_id
      )
      SELECT 
        PERCENT_RANK() OVER (ORDER BY avg_latency DESC) as speed_percentile
      FROM agent_speeds
      WHERE selected_agent_id = $1`,
      [agentId]
    );
    const speedPercentile = Number(speedPercentileResult.rows[0]?.speed_percentile) || 0.5;

    // Get audit status
    const auditResult = await query(
      `SELECT COUNT(*) as passed_audits
       FROM agent_audits 
       WHERE agent_id = $1 
       AND result = 'passed'
       AND audit_type = 'security'
       AND (valid_until IS NULL OR valid_until > NOW())`,
      [agentId]
    ).catch(() => ({ rows: [{ passed_audits: 0 }] }));
    const hasSecurityAudit = Number(auditResult.rows[0]?.passed_audits) > 0;

    // =========================================================================
    // CALCULATE SCORES
    // =========================================================================

    // Success Rate (0-500)
    const successRate = totalRequests > 0 ? successCount / totalRequests : 0.5;
    const successRateScore = Math.round(successRate * 500);

    // Uptime (0-250)
    const uptimeRatio = activeDays > 0 ? successfulDays / activeDays : 0.5;
    const uptimeScore = Math.round(uptimeRatio * 250);

    // Speed (0-150) - higher percentile = faster = higher score
    const speedScore = Math.round(speedPercentile * 150);

    // Longevity (0-100)
    const longevityRatio = Math.min(ageInDays / 365, 1);
    const longevityScore = Math.round(longevityRatio * 100);

    // Bonuses
    const verifiedBonus = agent.verified_status === "verified" ? REPUTATION_FORMULA.bonuses.verified : 0;
    const auditBonus = hasSecurityAudit ? REPUTATION_FORMULA.bonuses.securityAudit : 0;

    // Penalties
    const healthPenalty = Math.max(
      REPUTATION_FORMULA.penalties.maxHealthPenalty,
      consecutiveFailures * REPUTATION_FORMULA.penalties.healthCheckFailure
    );
    const errorPenalty = Math.max(
      REPUTATION_FORMULA.penalties.maxErrorPenalty,
      recentErrors * REPUTATION_FORMULA.penalties.recentError
    );

    // Total calculated score
    const rawScore = successRateScore + uptimeScore + speedScore + longevityScore +
                     verifiedBonus + auditBonus + healthPenalty + errorPenalty;
    const calculatedScore = Math.max(0, Math.min(REPUTATION_FORMULA.maxScore, Math.round(rawScore)));

    // =========================================================================
    // PROVISIONAL SCORE (Cold Start Protection)
    // =========================================================================
    // New agents with < 50 requests get a blended provisional score so they
    // have a fair chance to be selected and build their reputation.
    const isProvisional = totalRequests < REPUTATION_FORMULA.provisionalRequestThreshold;
    let finalScore: number;
    let provisionalBlend: number | undefined;

    if (isProvisional && totalRequests > 0) {
      // Blend: as requests increase, weight shifts from provisional to calculated
      const weight = totalRequests / REPUTATION_FORMULA.provisionalRequestThreshold;
      finalScore = Math.round(
        REPUTATION_FORMULA.provisionalScore * (1 - weight) + calculatedScore * weight
      );
      provisionalBlend = Math.round(weight * 100);
    } else if (totalRequests === 0) {
      // Brand new agent - full provisional score
      finalScore = REPUTATION_FORMULA.provisionalScore;
    } else {
      // Established agent - use calculated score
      finalScore = calculatedScore;
    }

    return {
      success: true,
      score: finalScore,
      factors: {
        successRate: {
          value: Math.round(successRate * 100),
          score: successRateScore,
          weight: "50%",
        },
        uptime: {
          value: Math.round(uptimeRatio * 100),
          score: uptimeScore,
          weight: "25%",
        },
        speed: {
          value: Math.round(avgLatencyMs),
          percentile: Math.round(speedPercentile * 100),
          score: speedScore,
          weight: "15%",
        },
        longevity: {
          value: ageInDays,
          score: longevityScore,
          weight: "10%",
        },
        bonuses: {
          verified: verifiedBonus,
          audit: auditBonus,
        },
        penalties: {
          healthCheck: healthPenalty,
          recentErrors: errorPenalty,
        },
        provisional: isProvisional ? {
          isProvisional: true,
          requestsUntilFull: REPUTATION_FORMULA.provisionalRequestThreshold - totalRequests,
          blendWeight: provisionalBlend,
          baseScore: REPUTATION_FORMULA.provisionalScore,
          calculatedScore,
        } : undefined,
        total: finalScore,
        formula: "(success_rate × 500) + (uptime × 250) + (speed_percentile × 150) + (longevity × 100) + bonuses - penalties",
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// VERIFICATION & AUDIT MANAGEMENT
// =============================================================================

/**
 * Update agent verification status
 */
export async function updateVerificationStatus(
  agentId: string,
  status: "unverified" | "pending" | "verified" | "suspended",
  verifiedBy?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await query(
      `UPDATE agents 
       SET verified_status = $1, 
           verified_at = CASE WHEN $1 = 'verified' THEN now() ELSE verified_at END,
           verified_by = COALESCE($2, verified_by),
           updated_at = now()
       WHERE id = $3
       RETURNING id`,
      [status, verifiedBy, agentId]
    );

    if (result.rows.length === 0) {
      return { success: false, error: "Agent not found" };
    }

    // Log version history
    await recordVersionHistory(agentId, "N/A", "verification_change", {
      newStatus: status,
      verifiedBy,
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Create a new audit record
 */
export async function createAudit(
  agentId: string,
  auditData: {
    auditType: string;
    auditorId?: string;
    auditorName?: string;
    auditorType?: string;
    summary?: string;
    details?: any;
    evidenceUrl?: string;
    validUntil?: Date;
    score?: number;
    notes?: string;
  }
): Promise<{ success: boolean; audit?: AgentAudit; error?: string }> {
  try {
    const id = uuidv4();
    const certificateHash = generateCertificateHash(agentId, auditData);

    const result = await query(
      `INSERT INTO agent_audits (
        id, agent_id, audit_type, result, auditor_id, auditor_name, auditor_type,
        summary, details_json, evidence_url, certificate_hash, valid_until, score, notes
      ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        id,
        agentId,
        auditData.auditType,
        auditData.auditorId || null,
        auditData.auditorName || null,
        auditData.auditorType || "system",
        auditData.summary || null,
        auditData.details ? JSON.stringify(auditData.details) : null,
        auditData.evidenceUrl || null,
        certificateHash,
        auditData.validUntil || null,
        auditData.score || null,
        auditData.notes || null,
      ]
    );

    return { success: true, audit: formatAuditRow(result.rows[0]) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Update audit result
 */
export async function updateAuditResult(
  auditId: string,
  result: "passed" | "failed" | "pending" | "expired",
  score?: number,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const queryResult = await query(
      `UPDATE agent_audits 
       SET result = $1, score = COALESCE($2, score), notes = COALESCE($3, notes), updated_at = now()
       WHERE id = $4
       RETURNING agent_id`,
      [result, score, notes, auditId]
    );

    if (queryResult.rows.length === 0) {
      return { success: false, error: "Audit not found" };
    }

    // If audit passed, potentially update agent verification status
    if (result === "passed") {
      const agentId = queryResult.rows[0].agent_id;
      
      // Check if all required audits have passed
      const passedAudits = await query(
        `SELECT COUNT(*) as count FROM agent_audits 
         WHERE agent_id = $1 
         AND result = 'passed' 
         AND (valid_until IS NULL OR valid_until > now())`,
        [agentId]
      );

      // Auto-verify if at least one valid passed audit exists
      if (parseInt(passedAudits.rows[0].count) > 0) {
        await updateVerificationStatus(agentId, "verified", "system_auto");
      }
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get agent audits
 */
export async function getAgentAudits(
  agentId: string,
  options?: { type?: string; result?: string; limit?: number }
): Promise<{ success: boolean; audits?: AgentAudit[]; error?: string }> {
  try {
    let sql = `SELECT * FROM agent_audits WHERE agent_id = $1`;
    const params: any[] = [agentId];
    let paramIndex = 2;

    if (options?.type) {
      sql += ` AND audit_type = $${paramIndex++}`;
      params.push(options.type);
    }
    if (options?.result) {
      sql += ` AND result = $${paramIndex++}`;
      params.push(options.result);
    }

    sql += ` ORDER BY created_at DESC`;

    if (options?.limit) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(options.limit);
    }

    const result = await query(sql, params);
    return { success: true, audits: result.rows.map(formatAuditRow) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// CAPABILITY MANAGEMENT
// =============================================================================

/**
 * Add or update a capability
 */
export async function setCapability(
  agentId: string,
  capability: string,
  proficiencyLevel: string = "intermediate",
  metadata?: any
): Promise<{ success: boolean; capability?: AgentCapability; error?: string }> {
  try {
    const result = await query(
      `INSERT INTO agent_capabilities (agent_id, capability, proficiency_level, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (agent_id, capability) 
       DO UPDATE SET proficiency_level = $3, metadata = COALESCE($4, agent_capabilities.metadata)
       RETURNING *`,
      [agentId, capability, proficiencyLevel, metadata ? JSON.stringify(metadata) : null]
    );

    return { success: true, capability: formatCapabilityRow(result.rows[0]) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Remove a capability
 */
export async function removeCapability(
  agentId: string,
  capability: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await query(
      `DELETE FROM agent_capabilities WHERE agent_id = $1 AND capability = $2`,
      [agentId, capability]
    );
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get agent capabilities
 */
export async function getAgentCapabilities(
  agentId: string
): Promise<{ success: boolean; capabilities?: AgentCapability[]; error?: string }> {
  try {
    const result = await query(
      `SELECT * FROM agent_capabilities WHERE agent_id = $1 ORDER BY capability`,
      [agentId]
    );
    return { success: true, capabilities: result.rows.map(formatCapabilityRow) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Find agents by capability
 */
export async function findAgentsByCapability(
  capability: string,
  options?: { minProficiency?: string; verifiedOnly?: boolean; limit?: number }
): Promise<{ success: boolean; agents?: any[]; error?: string }> {
  try {
    const proficiencyOrder = ["basic", "intermediate", "advanced", "expert"];
    const minIndex = options?.minProficiency
      ? proficiencyOrder.indexOf(options.minProficiency)
      : 0;

    let sql = `
      SELECT a.id, a.name, a.reputation_score, a.verified_status, 
             c.proficiency_level, c.is_verified as capability_verified
      FROM agents a
      INNER JOIN agent_capabilities c ON a.id = c.agent_id
      WHERE c.capability = $1
    `;
    const params: any[] = [capability];
    let paramIndex = 2;

    if (options?.verifiedOnly) {
      sql += ` AND a.verified_status = 'verified'`;
    }

    sql += ` ORDER BY a.reputation_score DESC`;

    if (options?.limit) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(options.limit);
    }

    const result = await query(sql, params);

    // Filter by proficiency level
    const filtered = result.rows.filter((row: any) => {
      const rowIndex = proficiencyOrder.indexOf(row.proficiency_level);
      return rowIndex >= minIndex;
    });

    return { success: true, agents: filtered };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// VERSION HISTORY
// =============================================================================

/**
 * Record a version history entry
 */
export async function recordVersionHistory(
  agentId: string,
  version: string,
  changeType: string,
  changes: any,
  options?: { changedBy?: string; changeReason?: string; isBreakingChange?: boolean; migrationNotes?: string }
): Promise<{ success: boolean; entry?: VersionHistoryEntry; error?: string }> {
  try {
    // Get current agent state for snapshot
    const agentResult = await query(`SELECT * FROM agents WHERE id = $1`, [agentId]);
    if (agentResult.rows.length === 0) {
      return { success: false, error: "Agent not found" };
    }

    const snapshot = formatAgentRow(agentResult.rows[0]);

    const result = await query(
      `INSERT INTO agent_version_history (
        agent_id, version, change_type, snapshot_json, changes_json, 
        changed_by, change_reason, is_breaking_change, migration_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        agentId,
        version,
        changeType,
        JSON.stringify(snapshot),
        JSON.stringify(changes),
        options?.changedBy || null,
        options?.changeReason || null,
        options?.isBreakingChange ? "true" : "false",
        options?.migrationNotes || null,
      ]
    );

    return { success: true, entry: formatVersionHistoryRow(result.rows[0]) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get version history for an agent
 */
export async function getVersionHistory(
  agentId: string,
  options?: { limit?: number; changeType?: string }
): Promise<{ success: boolean; history?: VersionHistoryEntry[]; error?: string }> {
  try {
    let sql = `SELECT * FROM agent_version_history WHERE agent_id = $1`;
    const params: any[] = [agentId];
    let paramIndex = 2;

    if (options?.changeType) {
      sql += ` AND change_type = $${paramIndex++}`;
      params.push(options.changeType);
    }

    sql += ` ORDER BY created_at DESC`;

    if (options?.limit) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(options.limit);
    }

    const result = await query(sql, params);
    return { success: true, history: result.rows.map(formatVersionHistoryRow) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// TOOL METADATA MANAGEMENT
// =============================================================================

/**
 * Update tool metadata
 */
export async function updateToolMetadata(
  toolId: string,
  metadata: Partial<{
    description: string;
    version: string;
    category: string;
    inputSchema: any;
    outputSchema: any;
    examples: any[];
    avgTokensPerCall: number;
    maxTokensPerCall: number;
    docsUrl: string;
    isDeprecated: boolean;
    deprecationMessage: string;
  }>
): Promise<{ success: boolean; tool?: ToolMetadata; error?: string }> {
  try {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (metadata.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(metadata.description);
    }
    if (metadata.version !== undefined) {
      updates.push(`version = $${paramIndex++}`);
      values.push(metadata.version);
    }
    if (metadata.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      values.push(metadata.category);
    }
    if (metadata.inputSchema !== undefined) {
      updates.push(`input_schema = $${paramIndex++}`);
      values.push(JSON.stringify(metadata.inputSchema));
    }
    if (metadata.outputSchema !== undefined) {
      updates.push(`output_schema = $${paramIndex++}`);
      values.push(JSON.stringify(metadata.outputSchema));
    }
    if (metadata.examples !== undefined) {
      updates.push(`examples_json = $${paramIndex++}`);
      values.push(JSON.stringify(metadata.examples));
    }
    if (metadata.avgTokensPerCall !== undefined) {
      updates.push(`avg_tokens_per_call = $${paramIndex++}`);
      values.push(metadata.avgTokensPerCall);
    }
    if (metadata.maxTokensPerCall !== undefined) {
      updates.push(`max_tokens_per_call = $${paramIndex++}`);
      values.push(metadata.maxTokensPerCall);
    }
    if (metadata.docsUrl !== undefined) {
      updates.push(`docs_url = $${paramIndex++}`);
      values.push(metadata.docsUrl);
    }
    if (metadata.isDeprecated !== undefined) {
      updates.push(`is_deprecated = $${paramIndex++}`);
      values.push(metadata.isDeprecated ? "true" : "false");
      if (metadata.isDeprecated) {
        updates.push(`deprecated_at = now()`);
      }
    }
    if (metadata.deprecationMessage !== undefined) {
      updates.push(`deprecation_message = $${paramIndex++}`);
      values.push(metadata.deprecationMessage);
    }

    if (updates.length === 0) {
      return { success: false, error: "No fields to update" };
    }

    updates.push(`updated_at = now()`);
    values.push(toolId);

    const result = await query(
      `UPDATE tools SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return { success: false, error: "Tool not found" };
    }

    return { success: true, tool: formatToolRow(result.rows[0]) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get tools by category
 */
export async function getToolsByCategory(
  category: string,
  options?: { verifiedAgentsOnly?: boolean; limit?: number }
): Promise<{ success: boolean; tools?: any[]; error?: string }> {
  try {
    let sql = `
      SELECT t.*, a.name as agent_name, a.reputation_score, a.verified_status
      FROM tools t
      INNER JOIN agents a ON t.agent_id = a.id
      WHERE t.category = $1 AND t.is_active = 'true' AND t.is_deprecated = 'false'
    `;
    const params: any[] = [category];
    let paramIndex = 2;

    if (options?.verifiedAgentsOnly) {
      sql += ` AND a.verified_status = 'verified'`;
    }

    sql += ` ORDER BY a.reputation_score DESC`;

    if (options?.limit) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(options.limit);
    }

    const result = await query(sql, params);
    return {
      success: true,
      tools: result.rows.map((row: any) => ({
        ...formatToolRow(row),
        agentName: row.agent_name,
        agentReputationScore: row.reputation_score,
        agentVerifiedStatus: row.verified_status,
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// DISCOVERY & SEARCH
// =============================================================================

/**
 * Search agents by various criteria
 */
export async function searchAgents(options: {
  query?: string;
  category?: string;
  capability?: string;
  verifiedOnly?: boolean;
  minReputationScore?: number;
  limit?: number;
  offset?: number;
}): Promise<{ success: boolean; agents?: any[]; total?: number; error?: string }> {
  try {
    let sql = `
      SELECT DISTINCT a.*, 
             array_agg(DISTINCT ac.capability) FILTER (WHERE ac.capability IS NOT NULL) as capabilities
      FROM agents a
      LEFT JOIN agent_capabilities ac ON a.id = ac.agent_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (options.query) {
      sql += ` AND (
        a.name ILIKE $${paramIndex} OR 
        a.bio ILIKE $${paramIndex} OR 
        a.id ILIKE $${paramIndex}
      )`;
      params.push(`%${options.query}%`);
      paramIndex++;
    }

    if (options.category) {
      sql += ` AND a.categories::jsonb ? $${paramIndex}`;
      params.push(options.category);
      paramIndex++;
    }

    if (options.capability) {
      sql += ` AND ac.capability = $${paramIndex}`;
      params.push(options.capability);
      paramIndex++;
    }

    if (options.verifiedOnly) {
      sql += ` AND a.verified_status = 'verified'`;
    }

    if (options.minReputationScore !== undefined) {
      sql += ` AND a.reputation_score >= $${paramIndex}`;
      params.push(options.minReputationScore);
      paramIndex++;
    }

    sql += ` GROUP BY a.id ORDER BY a.reputation_score DESC`;

    if (options.limit) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(options.limit);
      paramIndex++;
    }

    if (options.offset) {
      sql += ` OFFSET $${paramIndex}`;
      params.push(options.offset);
    }

    const result = await query(sql, params);
    
    return {
      success: true,
      agents: result.rows.map((row: any) => ({
        ...formatAgentRow(row),
        capabilities: row.capabilities || [],
      })),
      total: result.rows.length,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get leaderboard of top agents
 */
export async function getAgentLeaderboard(
  options?: { limit?: number; category?: string }
): Promise<{ success: boolean; leaderboard?: any[]; error?: string }> {
  try {
    let sql = `
      SELECT a.id, a.name, a.reputation_score, a.verified_status, a.categories,
             COUNT(DISTINCT tu.id) as total_calls_received,
             COUNT(DISTINCT tu.caller_agent_id) as unique_callers
      FROM agents a
      LEFT JOIN tool_usage tu ON a.id = tu.callee_agent_id AND tu.created_at > now() - interval '30 days'
      WHERE a.verified_status != 'suspended'
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (options?.category) {
      sql += ` AND a.categories::jsonb ? $${paramIndex}`;
      params.push(options.category);
      paramIndex++;
    }

    sql += ` GROUP BY a.id ORDER BY a.reputation_score DESC`;

    if (options?.limit) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(options.limit);
    } else {
      sql += ` LIMIT 50`;
    }

    const result = await query(sql, params);
    
    return {
      success: true,
      leaderboard: result.rows.map((row: any, index: number) => ({
        rank: index + 1,
        agentId: row.id,
        name: row.name,
        reputationScore: row.reputation_score,
        verifiedStatus: row.verified_status,
        categories: safeJsonParse(row.categories),
        stats: {
          totalCallsReceived30d: parseInt(row.total_calls_received) || 0,
          uniqueCallers30d: parseInt(row.unique_callers) || 0,
        },
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function formatAgentRow(row: any): any {
  return {
    agentId: row.id,
    name: row.name,
    publicKey: row.public_key,
    defaultRatePer1kTokens: Number(row.default_rate_per_1k_tokens),
    balanceLamports: Number(row.balance_lamports),
    pendingLamports: Number(row.pending_lamports),
    // Budget guardrails
    maxCostPerCall: row.max_cost_per_call ? Number(row.max_cost_per_call) : null,
    dailySpendCap: row.daily_spend_cap ? Number(row.daily_spend_cap) : null,
    isPaused: row.is_paused === "true",
    allowedCallees: safeJsonParse(row.allowed_callees),
    // Reputation & Trust
    reputationScore: row.reputation_score,
    verifiedStatus: row.verified_status,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    // Profile
    bio: row.bio,
    websiteUrl: row.website_url,
    logoUrl: row.logo_url,
    categories: safeJsonParse(row.categories),
    version: row.version,
    ownerEmail: row.owner_email,
    supportUrl: row.support_url,
    // Timestamps
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatToolRow(row: any): ToolMetadata {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    description: row.description,
    version: row.version,
    category: row.category,
    inputSchema: safeJsonParse(row.input_schema),
    outputSchema: safeJsonParse(row.output_schema),
    examplesJson: safeJsonParse(row.examples_json),
    avgTokensPerCall: row.avg_tokens_per_call,
    maxTokensPerCall: row.max_tokens_per_call,
    docsUrl: row.docs_url,
    isDeprecated: row.is_deprecated === "true",
    deprecationMessage: row.deprecation_message,
    totalCalls: Number(row.total_calls) || 0,
    totalTokensProcessed: Number(row.total_tokens_processed) || 0,
    lastCalledAt: row.last_called_at,
    ratePer1kTokens: Number(row.rate_per_1k_tokens),
    isActive: row.is_active === "true",
  };
}

function formatAuditRow(row: any): AgentAudit {
  return {
    id: row.id,
    agentId: row.agent_id,
    auditType: row.audit_type,
    result: row.result,
    auditorId: row.auditor_id,
    auditorName: row.auditor_name,
    auditorType: row.auditor_type,
    summary: row.summary,
    detailsJson: safeJsonParse(row.details_json),
    evidenceUrl: row.evidence_url,
    certificateHash: row.certificate_hash,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    score: row.score,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function formatCapabilityRow(row: any): AgentCapability {
  return {
    id: row.id,
    agentId: row.agent_id,
    capability: row.capability,
    proficiencyLevel: row.proficiency_level,
    isVerified: row.is_verified === "true",
    verifiedAt: row.verified_at,
    metadata: safeJsonParse(row.metadata),
    createdAt: row.created_at,
  };
}

function formatVersionHistoryRow(row: any): VersionHistoryEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    version: row.version,
    changeType: row.change_type,
    snapshotJson: safeJsonParse(row.snapshot_json),
    changesJson: safeJsonParse(row.changes_json),
    changedBy: row.changed_by,
    changeReason: row.change_reason,
    isBreakingChange: row.is_breaking_change === "true",
    migrationNotes: row.migration_notes,
    createdAt: row.created_at,
  };
}

function safeJsonParse(value: any): any {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function generateCertificateHash(agentId: string, auditData: any): string {
  const data = JSON.stringify({ agentId, ...auditData, timestamp: Date.now() });
  return Buffer.from(data).toString("base64").substring(0, 64);
}
