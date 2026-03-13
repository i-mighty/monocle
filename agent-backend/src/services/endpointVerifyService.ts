/**
 * Agent Endpoint Verification Service
 *
 * Verifies that registered agent endpoints are alive and respond correctly.
 * - Called at registration time (blocking)
 * - Called periodically to update endpoint health status
 */

import { query } from "../db/client";

// =============================================================================
// CONFIGURATION
// =============================================================================

const HEALTH_CHECK_TIMEOUT_MS = 10000; // 10 seconds
const REQUIRED_RESPONSE_FIELDS = ["status"]; // Minimum fields expected in health response

export interface HealthCheckResult {
  success: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
  responseBody?: any;
}

export interface EndpointStatus {
  agentId: string;
  endpointUrl: string;
  isHealthy: boolean;
  lastCheckAt: Date;
  consecutiveFailures: number;
  avgLatencyMs: number;
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

/**
 * Perform a health check on an agent endpoint
 *
 * Expected endpoint contract:
 * - GET /health returns { status: "ok", ... }
 * - Response time < 10 seconds
 * - HTTP 200 status
 */
export async function checkEndpointHealth(endpointUrl: string): Promise<HealthCheckResult> {
  const startTime = Date.now();

  try {
    // Construct health check URL
    const url = new URL(endpointUrl);
    const healthUrl = new URL("/health", url.origin).toString();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(healthUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Monocle-HealthCheck/1.0"
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      return {
        success: false,
        latencyMs,
        statusCode: response.status,
        error: `Endpoint returned HTTP ${response.status}`
      };
    }

    // Parse response body
    let body: any;
    try {
      body = await response.json();
    } catch {
      return {
        success: false,
        latencyMs,
        statusCode: response.status,
        error: "Endpoint did not return valid JSON"
      };
    }

    // Validate response has required fields
    const missingFields = REQUIRED_RESPONSE_FIELDS.filter(f => !(f in body));
    if (missingFields.length > 0) {
      return {
        success: false,
        latencyMs,
        statusCode: response.status,
        error: `Response missing required fields: ${missingFields.join(", ")}`,
        responseBody: body
      };
    }

    // Check status field indicates healthy
    if (body.status !== "ok" && body.status !== "healthy") {
      return {
        success: false,
        latencyMs,
        statusCode: response.status,
        error: `Endpoint status is "${body.status}", expected "ok" or "healthy"`,
        responseBody: body
      };
    }

    return {
      success: true,
      latencyMs,
      statusCode: response.status,
      responseBody: body
    };

  } catch (error: any) {
    const latencyMs = Date.now() - startTime;

    if (error.name === "AbortError") {
      return {
        success: false,
        latencyMs,
        error: `Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`
      };
    }

    return {
      success: false,
      latencyMs,
      error: error.message || "Unknown error during health check"
    };
  }
}

/**
 * Verify an endpoint and update database status
 */
export async function verifyAndUpdateEndpoint(agentId: string, endpointUrl: string): Promise<HealthCheckResult> {
  const result = await checkEndpointHealth(endpointUrl);

  // Update endpoint status in database
  try {
    await query(
      `UPDATE agent_endpoints
       SET is_healthy = $1,
           last_check_at = NOW(),
           last_check_latency_ms = $2,
           last_check_error = $3,
           consecutive_failures = CASE WHEN $1 THEN 0 ELSE consecutive_failures + 1 END,
           updated_at = NOW()
       WHERE agent_id = $4`,
      [result.success, result.latencyMs, result.error || null, agentId]
    );
  } catch (err) {
    // Table might not have all columns, try simpler update
    console.warn(`[EndpointVerify] Could not update full status for ${agentId}:`, err);
  }

  return result;
}

// =============================================================================
// BATCH VERIFICATION (for periodic job)
// =============================================================================

/**
 * Get all endpoints that need verification
 * - Not checked in the last hour
 * - Or have consecutive failures
 */
export async function getEndpointsNeedingVerification(limit: number = 100): Promise<Array<{
  agentId: string;
  endpointUrl: string;
}>> {
  try {
    const result = await query(
      `SELECT agent_id, endpoint_url
       FROM agent_endpoints
       WHERE is_active = true
         AND (last_check_at IS NULL OR last_check_at < NOW() - INTERVAL '1 hour')
       ORDER BY last_check_at ASC NULLS FIRST
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row: any) => ({
      agentId: row.agent_id,
      endpointUrl: row.endpoint_url
    }));
  } catch {
    return [];
  }
}

/**
 * Run verification job on all stale endpoints
 */
export async function runVerificationJob(): Promise<{
  checked: number;
  healthy: number;
  unhealthy: number;
}> {
  const endpoints = await getEndpointsNeedingVerification(50);

  let healthy = 0;
  let unhealthy = 0;

  for (const endpoint of endpoints) {
    const result = await verifyAndUpdateEndpoint(endpoint.agentId, endpoint.endpointUrl);
    if (result.success) {
      healthy++;
    } else {
      unhealthy++;
      console.warn(`[EndpointVerify] ${endpoint.agentId} unhealthy: ${result.error}`);
    }

    // Small delay between checks to avoid overwhelming endpoints
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`[EndpointVerify] Job complete: ${endpoints.length} checked, ${healthy} healthy, ${unhealthy} unhealthy`);

  return { checked: endpoints.length, healthy, unhealthy };
}

// =============================================================================
// DISABLE UNHEALTHY AGENTS
// =============================================================================

/**
 * Disable agents that have been unhealthy for too long
 * Called after verification job to clean up bad actors
 */
export async function disableUnhealthyAgents(consecutiveFailureThreshold: number = 5): Promise<number> {
  try {
    const result = await query(
      `UPDATE agent_endpoints
       SET is_active = false
       WHERE consecutive_failures >= $1 AND is_active = true
       RETURNING agent_id`,
      [consecutiveFailureThreshold]
    );

    if (result.rows.length > 0) {
      console.warn(`[EndpointVerify] Disabled ${result.rows.length} agents due to consecutive health check failures`);
    }

    return result.rows.length;
  } catch {
    return 0;
  }
}
