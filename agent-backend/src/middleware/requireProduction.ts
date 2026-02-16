/**
 * Production Environment Enforcement Middleware
 * 
 * Ensures the application is properly configured for production use.
 * Validates required environment variables and blocks startup if misconfigured.
 */

import { Request, Response, NextFunction } from "express";

// Required environment variables for production
const REQUIRED_PRODUCTION_ENV = [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "API_KEY",
  "SOLANA_PRIVATE_KEY"
] as const;

// Recommended but not required
const RECOMMENDED_PRODUCTION_ENV = [
  "SOLANA_RPC_URL",
  "SOLANA_NETWORK"
] as const;

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development" || !process.env.NODE_ENV;
}

/**
 * Validate all required production environment variables are set
 * Call this at startup to fail fast if misconfigured
 */
export function validateProductionEnvironment(): { valid: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

  // In production, all required vars must be set
  if (isProduction()) {
    for (const envVar of REQUIRED_PRODUCTION_ENV) {
      if (!process.env[envVar]) {
        missing.push(envVar);
      }
    }

    for (const envVar of RECOMMENDED_PRODUCTION_ENV) {
      if (!process.env[envVar]) {
        warnings.push(`Recommended: ${envVar} is not set`);
      }
    }

    // Ensure demo endpoints are disabled
    if (process.env.ALLOW_DEMO_ENDPOINTS === "true") {
      warnings.push("ALLOW_DEMO_ENDPOINTS is enabled in production - this is not recommended");
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings
  };
}

/**
 * Startup validation - throws if production environment is misconfigured
 */
export function enforceProductionRequirements(): void {
  const { valid, missing, warnings } = validateProductionEnvironment();

  // Log warnings
  for (const warning of warnings) {
    console.warn(`[PRODUCTION WARNING] ${warning}`);
  }

  if (!valid) {
    const error = `[FATAL] Production environment misconfigured. Missing required variables: ${missing.join(", ")}`;
    console.error(error);
    throw new Error(error);
  }

  if (isProduction()) {
    console.log("[PRODUCTION] Environment validation passed");
    console.log(`[PRODUCTION] Demo endpoints: ${process.env.ALLOW_DEMO_ENDPOINTS === "true" ? "ENABLED (not recommended)" : "DISABLED"}`);
  }
}

/**
 * Middleware to block requests if production requirements not met
 * Use this on critical routes that MUST have production config
 */
export function requireProductionConfig(req: Request, res: Response, next: NextFunction): void {
  const { valid, missing } = validateProductionEnvironment();

  if (!valid) {
    res.status(503).json({
      error: "Service Unavailable",
      message: "Server is not properly configured for this operation",
      code: "PRODUCTION_CONFIG_REQUIRED"
    });
    return;
  }

  next();
}

/**
 * Middleware that blocks mock/demo behavior in production
 * Ensures real database and services are used
 */
export function blockMockInProduction(req: Request, res: Response, next: NextFunction): void {
  if (isProduction() && !process.env.DATABASE_URL) {
    res.status(503).json({
      error: "Service Unavailable",
      message: "Database connection required in production",
      code: "DATABASE_REQUIRED"
    });
    return;
  }

  next();
}

/**
 * Middleware for routes that should ONLY work in production
 * (e.g., routes that interact with real Solana network)
 */
export function productionOnly(req: Request, res: Response, next: NextFunction): void {
  if (!isProduction()) {
    res.status(403).json({
      error: "Forbidden",
      message: "This endpoint is only available in production mode",
      code: "PRODUCTION_ONLY"
    });
    return;
  }

  next();
}

export default {
  isProduction,
  isDevelopment,
  validateProductionEnvironment,
  enforceProductionRequirements,
  requireProductionConfig,
  blockMockInProduction,
  productionOnly
};
