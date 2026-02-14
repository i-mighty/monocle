/**
 * Activity Logging & Audit Service
 *
 * Provides structured logging for critical events:
 * - identity_created: Agent identity verification and registration
 * - pricing_changed: Agent or tool pricing updates
 * - tool_executed: Tool call execution with cost tracking
 * - payment_executed: Balance topup or transfer
 * - settlement_completed: On-chain settlement finalization
 *
 * Enables:
 * - Audit trails for compliance
 * - Analytics and insights
 * - Compliance exports (SOC2, etc.)
 *
 * Security Features:
 * - Sensitive field encryption (credit card, keys, etc.)
 * - PII redaction
 * - Secure audit trail
 */

import { query } from "../db/client";
import { v4 as uuidv4 } from "uuid";
import {
  encryptSensitiveData,
  decryptSensitiveData,
  redactSensitiveFields,
} from "./securityService";

// =============================================================================
// TYPES
// =============================================================================

export type ActivityEventType =
  | "identity_created"
  | "pricing_changed"
  | "tool_executed"
  | "payment_executed"
  | "settlement_completed"
  | "agent_registered"
  | "agent_updated"
  | "tool_registered"
  | "budget_changed"
  | "verification_changed"
  | "capability_added"
  | "capability_removed"
  | "audit_created"
  | "api_key_used"
  | "error_occurred";

export type ActivitySeverity = "info" | "warning" | "error" | "critical";

export interface ActivityLogEntry {
  id: string;
  eventType: ActivityEventType;
  severity: ActivitySeverity;
  agentId?: string;
  actorId?: string;
  actorType: "agent" | "system" | "admin" | "api";
  resourceType?: string;
  resourceId?: string;
  action: string;
  description: string;
  metadata: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  durationMs?: number;
  createdAt: string;
}

export interface LogActivityInput {
  eventType: ActivityEventType;
  severity?: ActivitySeverity;
  agentId?: string;
  actorId?: string;
  actorType?: "agent" | "system" | "admin" | "api";
  resourceType?: string;
  resourceId?: string;
  action: string;
  description: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  durationMs?: number;
}

// =============================================================================
// SENSITIVE DATA HANDLING
// =============================================================================

// Fields that should be encrypted in logs
const SENSITIVE_FIELDS = [
  "password",
  "secret",
  "key",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "credit_card",
  "ssn",
  "private_key",
  "privateKey",
  "wallet_address",
  "signature",
];

// Fields that should be redacted (not stored at all)
const REDACT_FIELDS = [
  "password",
  "secret",
  "privateKey",
  "private_key",
  "ssn",
  "credit_card_number",
];

/**
 * Process metadata to encrypt/redact sensitive fields
 */
function processMetadataForStorage(metadata: Record<string, any>): {
  processed: Record<string, any>;
  encryptedFields: string[];
} {
  const processed = { ...metadata };
  const encryptedFields: string[] = [];

  function processObject(obj: Record<string, any>, path: string = ""): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      const lowerKey = key.toLowerCase();

      // Check if field should be redacted entirely
      if (REDACT_FIELDS.some((f) => lowerKey.includes(f.toLowerCase()))) {
        result[key] = "[REDACTED]";
        continue;
      }

      // Check if field should be encrypted
      if (SENSITIVE_FIELDS.some((f) => lowerKey.includes(f.toLowerCase()))) {
        if (typeof value === "string" && value.length > 0) {
          try {
            result[key] = encryptSensitiveData(value);
            encryptedFields.push(fullPath);
          } catch {
            result[key] = "[ENCRYPTION_FAILED]";
          }
        } else {
          result[key] = "[REDACTED]";
        }
        continue;
      }

      // Recursively process nested objects
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        result[key] = processObject(value, fullPath);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  return {
    processed: processObject(processed),
    encryptedFields,
  };
}

/**
 * Decrypt sensitive fields in metadata for authorized viewing
 */
export function decryptMetadata(
  metadata: Record<string, any>,
  encryptedFields: string[]
): Record<string, any> {
  const decrypted = { ...metadata };

  function decryptAtPath(obj: Record<string, any>, pathParts: string[]): void {
    if (pathParts.length === 0) return;

    const [current, ...rest] = pathParts;

    if (rest.length === 0) {
      // At the target field
      if (typeof obj[current] === "string") {
        const decryptedValue = decryptSensitiveData(obj[current]);
        obj[current] = decryptedValue || "[DECRYPTION_FAILED]";
      }
    } else if (typeof obj[current] === "object" && obj[current] !== null) {
      decryptAtPath(obj[current], rest);
    }
  }

  for (const fieldPath of encryptedFields) {
    decryptAtPath(decrypted, fieldPath.split("."));
  }

  return decrypted;
}

// =============================================================================
// CORE LOGGING FUNCTION
// =============================================================================

/**
 * Log an activity event to the database with automatic encryption of sensitive data
 */
export async function logActivity(input: LogActivityInput): Promise<ActivityLogEntry> {
  const id = uuidv4();
  const severity = input.severity || "info";
  const actorType = input.actorType || "system";
  const rawMetadata = input.metadata || {};

  // Process metadata to encrypt/redact sensitive fields
  const { processed: metadata, encryptedFields } = processMetadataForStorage(rawMetadata);

  // Add encryption metadata if any fields were encrypted
  if (encryptedFields.length > 0) {
    metadata.__encrypted_fields = encryptedFields;
  }

  try {
    const result = await query(
      `INSERT INTO activity_logs (
        id, event_type, severity, agent_id, actor_id, actor_type,
        resource_type, resource_id, action, description, metadata,
        ip_address, user_agent, request_id, duration_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        id,
        input.eventType,
        severity,
        input.agentId || null,
        input.actorId || null,
        actorType,
        input.resourceType || null,
        input.resourceId || null,
        input.action,
        input.description,
        JSON.stringify(metadata),
        input.ipAddress || null,
        input.userAgent || null,
        input.requestId || null,
        input.durationMs || null,
      ]
    );

    return formatLogEntry(result.rows[0]);
  } catch (error: any) {
    // Don't throw - logging failures shouldn't break the main flow
    console.error("[ActivityService] Failed to log activity:", error.message);
    
    // Return a fallback entry
    return {
      id,
      eventType: input.eventType,
      severity,
      agentId: input.agentId,
      actorId: input.actorId,
      actorType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      description: input.description,
      metadata,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      requestId: input.requestId,
      durationMs: input.durationMs,
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * Log activity asynchronously (fire-and-forget)
 * Use this when you don't need to wait for the log to be written
 */
export function logActivityAsync(input: LogActivityInput): void {
  logActivity(input).catch((err) => {
    console.error("[ActivityService] Async log failed:", err.message);
  });
}

// =============================================================================
// CONVENIENCE LOGGING FUNCTIONS
// =============================================================================

/**
 * Log identity creation
 */
export function logIdentityCreated(
  agentId: string,
  agentName: string,
  verificationStatus: string,
  metadata?: Record<string, any>
): void {
  logActivityAsync({
    eventType: "identity_created",
    severity: "info",
    agentId,
    actorType: "system",
    resourceType: "agent",
    resourceId: agentId,
    action: "identity.verify",
    description: `Agent "${agentName}" identity verified with status: ${verificationStatus}`,
    metadata: {
      agentName,
      verificationStatus,
      ...metadata,
    },
  });
}

/**
 * Log agent registration
 */
export function logAgentRegistered(
  agentId: string,
  agentName: string | null,
  ratePer1kTokens: number,
  metadata?: Record<string, any>
): void {
  logActivityAsync({
    eventType: "agent_registered",
    severity: "info",
    agentId,
    actorType: "api",
    resourceType: "agent",
    resourceId: agentId,
    action: "agent.register",
    description: `Agent "${agentName || agentId}" registered with rate ${ratePer1kTokens} lamports/1K tokens`,
    metadata: {
      agentName,
      ratePer1kTokens,
      ...metadata,
    },
  });
}

/**
 * Log pricing change
 */
export function logPricingChanged(
  agentId: string,
  resourceType: "agent" | "tool",
  resourceId: string,
  oldRate: number,
  newRate: number,
  changedBy?: string,
  metadata?: Record<string, any>
): void {
  logActivityAsync({
    eventType: "pricing_changed",
    severity: "info",
    agentId,
    actorId: changedBy,
    actorType: changedBy ? "api" : "system",
    resourceType,
    resourceId,
    action: "pricing.update",
    description: `${resourceType} "${resourceId}" pricing changed from ${oldRate} to ${newRate} lamports/1K tokens`,
    metadata: {
      oldRate,
      newRate,
      changePercent: oldRate > 0 ? ((newRate - oldRate) / oldRate * 100).toFixed(2) : null,
      ...metadata,
    },
  });
}

/**
 * Log tool execution
 */
export function logToolExecuted(
  callerId: string,
  calleeId: string,
  toolName: string,
  tokensUsed: number,
  costLamports: number,
  pricingSource: "quote" | "live",
  metadata?: Record<string, any>
): void {
  logActivityAsync({
    eventType: "tool_executed",
    severity: "info",
    agentId: callerId,
    actorId: callerId,
    actorType: "agent",
    resourceType: "tool",
    resourceId: toolName,
    action: "tool.execute",
    description: `Agent "${callerId}" executed "${toolName}" on "${calleeId}" for ${costLamports} lamports`,
    metadata: {
      callerId,
      calleeId,
      toolName,
      tokensUsed,
      costLamports,
      pricingSource,
      ...metadata,
    },
  });
}

/**
 * Log payment execution (topup, transfer)
 */
export function logPaymentExecuted(
  agentId: string,
  paymentType: "topup" | "transfer" | "debit" | "credit",
  amount: number,
  metadata?: Record<string, any>
): void {
  logActivityAsync({
    eventType: "payment_executed",
    severity: "info",
    agentId,
    actorType: "api",
    resourceType: "payment",
    resourceId: agentId,
    action: `payment.${paymentType}`,
    description: `Payment ${paymentType} of ${amount} lamports for agent "${agentId}"`,
    metadata: {
      paymentType,
      amount,
      ...metadata,
    },
  });
}

/**
 * Log settlement completion
 */
export function logSettlementCompleted(
  agentId: string,
  settlementId: string,
  grossAmount: number,
  platformFee: number,
  netAmount: number,
  txSignature: string,
  metadata?: Record<string, any>
): void {
  logActivityAsync({
    eventType: "settlement_completed",
    severity: "info",
    agentId,
    actorType: "system",
    resourceType: "settlement",
    resourceId: settlementId,
    action: "settlement.complete",
    description: `Settlement ${settlementId} completed for agent "${agentId}": ${netAmount} lamports (fee: ${platformFee})`,
    metadata: {
      settlementId,
      grossAmount,
      platformFee,
      netAmount,
      txSignature,
      feePercent: grossAmount > 0 ? ((platformFee / grossAmount) * 100).toFixed(2) : null,
      ...metadata,
    },
  });
}

/**
 * Log budget/guardrail changes
 */
export function logBudgetChanged(
  agentId: string,
  changeType: string,
  oldValue: any,
  newValue: any,
  changedBy?: string,
  metadata?: Record<string, any>
): void {
  logActivityAsync({
    eventType: "budget_changed",
    severity: "warning",
    agentId,
    actorId: changedBy,
    actorType: changedBy ? "api" : "system",
    resourceType: "agent",
    resourceId: agentId,
    action: `budget.${changeType}`,
    description: `Budget ${changeType} changed for agent "${agentId}"`,
    metadata: {
      changeType,
      oldValue,
      newValue,
      ...metadata,
    },
  });
}

/**
 * Log verification status change
 */
export function logVerificationChanged(
  agentId: string,
  oldStatus: string,
  newStatus: string,
  verifiedBy?: string,
  metadata?: Record<string, any>
): void {
  logActivityAsync({
    eventType: "verification_changed",
    severity: newStatus === "suspended" ? "critical" : "info",
    agentId,
    actorId: verifiedBy,
    actorType: verifiedBy ? "admin" : "system",
    resourceType: "agent",
    resourceId: agentId,
    action: "verification.update",
    description: `Agent "${agentId}" verification changed from ${oldStatus} to ${newStatus}`,
    metadata: {
      oldStatus,
      newStatus,
      verifiedBy,
      ...metadata,
    },
  });
}

/**
 * Log errors for audit trail
 */
export function logError(
  eventType: ActivityEventType,
  action: string,
  errorMessage: string,
  agentId?: string,
  metadata?: Record<string, any>
): void {
  logActivityAsync({
    eventType: "error_occurred",
    severity: "error",
    agentId,
    actorType: "system",
    action,
    description: `Error during ${action}: ${errorMessage}`,
    metadata: {
      originalEventType: eventType,
      errorMessage,
      ...metadata,
    },
  });
}

// =============================================================================
// QUERY FUNCTIONS
// =============================================================================

export interface ActivityQueryOptions {
  agentId?: string;
  eventType?: ActivityEventType;
  severity?: ActivitySeverity;
  actorType?: string;
  resourceType?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Query activity logs with filters
 */
export async function queryActivityLogs(
  options: ActivityQueryOptions = {}
): Promise<{ logs: ActivityLogEntry[]; total: number }> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (options.agentId) {
    conditions.push(`agent_id = $${paramIndex++}`);
    params.push(options.agentId);
  }
  if (options.eventType) {
    conditions.push(`event_type = $${paramIndex++}`);
    params.push(options.eventType);
  }
  if (options.severity) {
    conditions.push(`severity = $${paramIndex++}`);
    params.push(options.severity);
  }
  if (options.actorType) {
    conditions.push(`actor_type = $${paramIndex++}`);
    params.push(options.actorType);
  }
  if (options.resourceType) {
    conditions.push(`resource_type = $${paramIndex++}`);
    params.push(options.resourceType);
  }
  if (options.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(options.startDate);
  }
  if (options.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(options.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(options.limit || 100, 1000);
  const offset = options.offset || 0;

  // Get total count
  const countResult = await query(
    `SELECT COUNT(*) as total FROM activity_logs ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0]?.total || "0");

  // Get logs
  const logsResult = await query(
    `SELECT * FROM activity_logs ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return {
    logs: logsResult.rows.map(formatLogEntry),
    total,
  };
}

/**
 * Get activity summary/stats for an agent
 */
export async function getActivitySummary(
  agentId: string,
  days: number = 30
): Promise<{
  totalEvents: number;
  byEventType: Record<string, number>;
  bySeverity: Record<string, number>;
  recentErrors: ActivityLogEntry[];
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Count by event type
  const eventTypeResult = await query(
    `SELECT event_type, COUNT(*) as count
     FROM activity_logs
     WHERE agent_id = $1 AND created_at >= $2
     GROUP BY event_type`,
    [agentId, startDate]
  );

  // Count by severity
  const severityResult = await query(
    `SELECT severity, COUNT(*) as count
     FROM activity_logs
     WHERE agent_id = $1 AND created_at >= $2
     GROUP BY severity`,
    [agentId, startDate]
  );

  // Recent errors
  const errorsResult = await query(
    `SELECT * FROM activity_logs
     WHERE agent_id = $1 AND severity IN ('error', 'critical') AND created_at >= $2
     ORDER BY created_at DESC
     LIMIT 10`,
    [agentId, startDate]
  );

  const byEventType: Record<string, number> = {};
  eventTypeResult.rows.forEach((row: any) => {
    byEventType[row.event_type] = parseInt(row.count);
  });

  const bySeverity: Record<string, number> = {};
  severityResult.rows.forEach((row: any) => {
    bySeverity[row.severity] = parseInt(row.count);
  });

  const totalEvents = Object.values(byEventType).reduce((sum, count) => sum + count, 0);

  return {
    totalEvents,
    byEventType,
    bySeverity,
    recentErrors: errorsResult.rows.map(formatLogEntry),
  };
}

/**
 * Export activity logs for compliance (CSV format)
 */
export async function exportActivityLogs(
  options: ActivityQueryOptions & { format?: "json" | "csv" }
): Promise<string> {
  const { logs } = await queryActivityLogs({ ...options, limit: 10000 });

  if (options.format === "csv") {
    const headers = [
      "id", "event_type", "severity", "agent_id", "actor_id", "actor_type",
      "resource_type", "resource_id", "action", "description", "created_at"
    ];
    
    const rows = logs.map((log) => [
      log.id,
      log.eventType,
      log.severity,
      log.agentId || "",
      log.actorId || "",
      log.actorType,
      log.resourceType || "",
      log.resourceId || "",
      log.action,
      `"${log.description.replace(/"/g, '""')}"`,
      log.createdAt,
    ].join(","));

    return [headers.join(","), ...rows].join("\n");
  }

  return JSON.stringify(logs, null, 2);
}

// =============================================================================
// HELPERS
// =============================================================================

function formatLogEntry(row: any): ActivityLogEntry {
  return {
    id: row.id,
    eventType: row.event_type,
    severity: row.severity,
    agentId: row.agent_id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    action: row.action,
    description: row.description,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata || {}),
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    requestId: row.request_id,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}
