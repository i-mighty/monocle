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
 * Tries multiple endpoints in order of preference:
 * 1. GET /health - standard health endpoint
 * 2. GET / - root endpoint (many APIs respond here)
 * 3. HEAD to base URL - lightweight ping
 *
 * Only rejects on CONNECTION errors (timeouts, refused, unreachable).
 * 404s are acceptable if we get a valid response from another endpoint.
 */
export async function checkEndpointHealth(endpointUrl: string): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const url = new URL(endpointUrl);
  const baseOrigin = url.origin;

  // Endpoints to try in order
  const endpointsToTry = [
    { path: "/health", method: "GET" as const, expectJson: true },
    { path: "/", method: "GET" as const, expectJson: false },
    { path: "/", method: "HEAD" as const, expectJson: false },
  ];

  let lastError: string = "";
  let connectionFailed = false;

  for (const endpoint of endpointsToTry) {
    const checkUrl = new URL(endpoint.path, baseOrigin).toString();
    const checkStart = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(checkUrl, {
        method: endpoint.method,
        headers: {
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Monocle-HealthCheck/1.0"
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - checkStart;

      // Any successful HTTP response means the server is reachable
      if (response.ok) {
        // For /health endpoint, validate JSON response if expected
        if (endpoint.expectJson) {
          try {
            const body = await response.json();
            // Check for explicit healthy/ok status
            if (body.status === "ok" || body.status === "healthy" || body.healthy === true) {
              return {
                success: true,
                latencyMs,
                statusCode: response.status,
                responseBody: body
              };
            }
            // Has JSON but no clear healthy indicator - still count as success
            return {
              success: true,
              latencyMs,
              statusCode: response.status,
              responseBody: body
            };
          } catch {
            // JSON parse failed, but server responded - try next endpoint
            lastError = "Health endpoint did not return valid JSON";
            continue;
          }
        }

        // Non-JSON endpoint succeeded
        return {
          success: true,
          latencyMs,
          statusCode: response.status
        };
      }

      // 404 is acceptable - just try next endpoint
      if (response.status === 404) {
        lastError = `${endpoint.path} returned 404`;
        continue;
      }

      // 5xx errors indicate server problems but not connection issues
      if (response.status >= 500) {
        lastError = `Server error: HTTP ${response.status}`;
        continue;
      }

      // Other 4xx - authentication issues, etc. - server is reachable
      // For HEAD requests, 405 (method not allowed) is fine - server is up
      if (endpoint.method === "HEAD" && (response.status === 405 || response.status === 400)) {
        return {
          success: true,
          latencyMs: Date.now() - checkStart,
          statusCode: response.status
        };
      }

      lastError = `HTTP ${response.status}`;

    } catch (error: any) {
      const latencyMs = Date.now() - checkStart;

      if (error.name === "AbortError") {
        lastError = `Timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`;
        connectionFailed = true;
        continue; // Try next endpoint
      }

      // Connection refused, DNS failure, etc. - real connection problem
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND" || 
          error.code === "ETIMEDOUT" || error.code === "ENETUNREACH") {
        connectionFailed = true;
        lastError = error.message || "Connection failed";
        // Don't try more endpoints - server is unreachable
        break;
      }

      lastError = error.message || "Unknown error";
    }
  }

  // All endpoints failed
  return {
    success: false,
    latencyMs: Date.now() - startTime,
    error: connectionFailed 
      ? `Connection failed: ${lastError}` 
      : `All health check endpoints failed. Last error: ${lastError}`
  };
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
