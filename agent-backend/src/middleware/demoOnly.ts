/**
 * Demo/Development-Only Middleware
 * 
 * Protects demo and testing endpoints from being accessed in production.
 * Controlled via environment variables:
 * 
 * - NODE_ENV: 'production' triggers protection
 * - ALLOW_DEMO_ENDPOINTS: 'true' overrides and allows demo endpoints
 * 
 * Usage:
 *   import { demoOnly, isDemoAllowed } from "../middleware/demoOnly";
 *   router.post("/test-endpoint", demoOnly, async (req, res) => { ... });
 */

import { Request, Response, NextFunction } from "express";

/**
 * Check if demo endpoints are allowed in the current environment
 */
export function isDemoAllowed(): boolean {
  const nodeEnv = process.env.NODE_ENV || "development";
  const allowOverride = process.env.ALLOW_DEMO_ENDPOINTS === "true";
  
  // Allow in non-production environments
  if (nodeEnv !== "production") {
    return true;
  }
  
  // In production, only allow if explicitly enabled
  return allowOverride;
}

/**
 * Middleware to block demo endpoints in production
 * 
 * Returns 403 Forbidden with clear message when demo endpoints are disabled.
 */
export function demoOnly(req: Request, res: Response, next: NextFunction): void {
  if (isDemoAllowed()) {
    return next();
  }
  
  res.status(403).json({
    error: "Demo endpoint disabled",
    message: "This endpoint is only available in development/testing environments.",
    code: "DEMO_ENDPOINT_DISABLED",
    hint: "Set ALLOW_DEMO_ENDPOINTS=true to enable in production (not recommended).",
    documentation: "https://docs.agentpay.dev/production#demo-endpoints",
  });
}

/**
 * Middleware to add a warning header for demo endpoints
 * 
 * Useful for endpoints that are allowed but should be used with caution.
 */
export function demoWarning(req: Request, res: Response, next: NextFunction): void {
  if (!isDemoAllowed()) {
    // If demo is not allowed, use strict blocking
    return demoOnly(req, res, next);
  }
  
  // Add warning header for development environments
  res.setHeader("X-Demo-Endpoint", "true");
  res.setHeader("X-Demo-Warning", "This endpoint is for development/testing only.");
  next();
}

/**
 * List of demo endpoint patterns for documentation
 */
export const DEMO_ENDPOINTS = [
  { path: "/v1/payments/topup", method: "POST", description: "Add test funds to agent" },
  { path: "/v1/agents/fund", method: "POST", description: "Add test funds to agent" },
  { path: "/v1/x402/demo-resource", method: "GET", description: "Demo x402 protected resource" },
  { path: "/v1/x402/simulate", method: "POST", description: "Simulate x402 payment flow" },
  { path: "/v1/simulation/*", method: "*", description: "Cost simulation endpoints" },
  { path: "/v1/webhooks/test", method: "POST", description: "Test webhook delivery" },
  { path: "/v1/webhooks/verify-signature", method: "POST", description: "Verify webhook signature" },
  { path: "/v1/anti-abuse/test-*, ", method: "*", description: "Anti-abuse testing endpoints" },
];

/**
 * Get info about demo endpoint status
 */
export function getDemoStatus() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const allowOverride = process.env.ALLOW_DEMO_ENDPOINTS === "true";
  const isAllowed = isDemoAllowed();
  
  return {
    environment: nodeEnv,
    demoEndpointsEnabled: isAllowed,
    overrideActive: nodeEnv === "production" && allowOverride,
    endpoints: DEMO_ENDPOINTS,
    configuration: {
      NODE_ENV: nodeEnv,
      ALLOW_DEMO_ENDPOINTS: allowOverride ? "true" : "false (default)",
    },
  };
}
