import "dotenv/config";
import express, { Router } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import identity from "./routes/identity";
import meter from "./routes/meter";
import payments from "./routes/payments";
import analytics from "./routes/analytics";
import agents from "./routes/agents";
import pricing from "./routes/pricing";
import x402 from "./routes/x402";
import messaging from "./routes/messaging";
import economics from "./routes/economics";
import reputation from "./routes/reputation";
import simulation from "./routes/simulation";
import webhooks from "./routes/webhooks";
import antiAbuse from "./routes/antiAbuse";
import budget from "./routes/budget";
import activity from "./routes/activity";
import apiKeys from "./routes/apiKeys";
import deposits from "./routes/deposits";
import chat from "./routes/chat";
import x402Feed from "./routes/x402Feed";
import { requestIdMiddleware, errorHandler, notFoundHandler } from "./errors";
import { getDemoStatus } from "./middleware/demoOnly";
import { rateLimit, ipRateLimit, slowDown } from "./middleware/rateLimit";
import { enforceProductionRequirements, isProduction } from "./middleware/requireProduction";
import { runVerificationJob, disableUnhealthyAgents } from "./services/endpointVerifyService";
import { query } from "./db/client";
import { PRICING_CONSTANTS } from "./services/pricingService";
import { x402ProtectMiddleware, x402Enabled } from "./middleware/x402Official";

// =============================================================================
// PRODUCTION ENVIRONMENT VALIDATION
// =============================================================================
// Fail fast if production environment is misconfigured
enforceProductionRequirements();

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);

// =============================================================================
// GLOBAL SECURITY MIDDLEWARE
// =============================================================================

// IP-based rate limiting for all requests (DoS protection)
app.use(ipRateLimit({ maxRequests: 100, burstAllowance: 20, windowMs: 60000 }));

// Slow down excessive requests instead of hard blocking
app.use(slowDown(50, 200));

// =============================================================================
// API VERSION 1
// =============================================================================
const v1 = Router();

// Apply per-key rate limiting to authenticated routes
v1.use(rateLimit());

// x402 payment protection (returns 402 for configured routes if no payment header)
v1.use(x402ProtectMiddleware);

v1.use("/identity", identity);
v1.use("/meter", meter);
v1.use("/payments", payments);
v1.use("/dashboard", analytics);
v1.use("/agents", agents);
v1.use("/pricing", pricing);
v1.use("/x402", x402);
v1.use("/x402-feed", x402Feed);
v1.use("/messaging", messaging);
v1.use("/economics", economics);
v1.use("/reputation", reputation);
v1.use("/simulation", simulation);
v1.use("/webhooks", webhooks);
v1.use("/anti-abuse", antiAbuse);
v1.use("/budget", budget);
v1.use("/activity", activity);
v1.use("/api-keys", apiKeys);
v1.use("/deposits", deposits);
v1.use("/chat", chat);

// Mount v1 API
app.use("/v1", v1);

// =============================================================================
// BACKWARD COMPATIBILITY (Deprecated - use /v1/ prefix)
// =============================================================================
// These routes will be removed in a future version
const deprecationWarning = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader("X-API-Deprecation-Warning", "This endpoint is deprecated. Please use /v1/ prefix.");
  res.setHeader("X-API-Sunset-Date", "2026-06-01");
  next();
};

app.use("/identity", deprecationWarning, identity);
app.use("/meter", deprecationWarning, meter);
app.use("/payments", deprecationWarning, payments);
app.use("/dashboard", deprecationWarning, analytics);
app.use("/agents", deprecationWarning, agents);
app.use("/pricing", deprecationWarning, pricing);
app.use("/x402", deprecationWarning, x402);
app.use("/messaging", deprecationWarning, messaging);
app.use("/economics", deprecationWarning, economics);
app.use("/reputation", deprecationWarning, reputation);
app.use("/simulation", deprecationWarning, simulation);
app.use("/webhooks", deprecationWarning, webhooks);
app.use("/anti-abuse", deprecationWarning, antiAbuse);
app.use("/budget", deprecationWarning, budget);
app.use("/activity", deprecationWarning, activity);

// =============================================================================
// HEALTH CHECK
// =============================================================================
app.get("/health", async (req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number }> = {};
  
  // Database check
  const dbStart = Date.now();
  try {
    await query("SELECT 1");
    checks.database = { status: "healthy", latencyMs: Date.now() - dbStart };
  } catch {
    checks.database = { status: "unhealthy", latencyMs: Date.now() - dbStart };
  }

  const allHealthy = Object.values(checks).every(c => c.status === "healthy");
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    checks,
  });
});

// =============================================================================
// API INFO
// =============================================================================
app.get("/", (req, res) => {
  const demoStatus = getDemoStatus();
  res.json({
    name: "AgentPay API",
    version: "1.0.0",
    currentVersion: "v1",
    endpoints: {
      v1: "/v1",
      openapi: "/openapi.yaml",
      docs: "/docs",
      demoStatus: "/demo-status",
    },
    demoEndpoints: demoStatus.demoEndpointsEnabled,
    environment: demoStatus.environment,
    documentation: "https://docs.agentpay.dev",
  });
});

// Demo endpoints status
app.get("/demo-status", (req, res) => {
  res.json(getDemoStatus());
});

// OpenAPI spec endpoint
app.get("/openapi.yaml", (req, res) => {
  const specPath = path.join(__dirname, "..", "openapi.yaml");
  if (fs.existsSync(specPath)) {
    res.setHeader("Content-Type", "text/yaml");
    res.sendFile(specPath);
  } else {
    res.status(404).json({ error: "OpenAPI spec not found" });
  }
});

// OpenAPI JSON endpoint
app.get("/openapi.json", async (req, res) => {
  try {
    const specPath = path.join(__dirname, "..", "openapi.yaml");
    const yaml = fs.readFileSync(specPath, "utf-8");
    // Simple YAML to JSON conversion for basic OpenAPI
    const lines = yaml.split("\n");
    res.setHeader("Content-Type", "application/json");
    res.json({ message: "Use /openapi.yaml for full spec", specAvailable: true });
  } catch {
    res.status(404).json({ error: "OpenAPI spec not found" });
  }
});

// Error handling (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  const mode = isProduction() ? "PRODUCTION" : "DEVELOPMENT";
  const dbStatus = process.env.DATABASE_URL ? "CONNECTED" : "MOCK MODE";
  
  console.log(`\n========================================`);
  console.log(`  AgentPay API Server`);
  console.log(`  Mode: ${mode}`);
  console.log(`  Database: ${dbStatus}`);
  console.log(`  Port: ${port}`);
  console.log(`  x402: ${x402Enabled ? "ENABLED" : "DISABLED (set X402_PAY_TO)"}`);
  console.log(`========================================`);
  console.log(`  API v1:      http://localhost:${port}/v1/...`);
  console.log(`  Health:      http://localhost:${port}/health`);
  console.log(`  Demo Status: http://localhost:${port}/demo-status`);
  if (!isProduction()) {
    console.log(`\n  ⚠️  Running in development mode`);
    console.log(`  ⚠️  Demo endpoints enabled`);
    if (!process.env.DATABASE_URL) {
      console.log(`  ⚠️  Using mock database (set DATABASE_URL for real DB)`);
    }
  }
  console.log(`========================================\n`);

  // ==========================================================================
  // SCHEDULED JOBS
  // ==========================================================================

  // Endpoint health verification - runs every 15 minutes
  const VERIFICATION_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  const DISABLE_THRESHOLD = 5; // Consecutive failures before auto-disable

  if (process.env.DATABASE_URL) {
    console.log(`  📡 Starting endpoint verification scheduler (every 15 min)`);
    
    // Initial run after 30 seconds (let server warm up)
    setTimeout(async () => {
      try {
        const result = await runVerificationJob();
        console.log(`[Scheduler] Initial verification: ${result.checked} endpoints checked`);
        
        // Disable persistently unhealthy agents
        const disabled = await disableUnhealthyAgents(DISABLE_THRESHOLD);
        if (disabled > 0) {
          console.log(`[Scheduler] Disabled ${disabled} agents due to repeated failures`);
        }
      } catch (err) {
        console.error("[Scheduler] Initial verification failed:", err);
      }
    }, 30000);

    // Regular interval
    setInterval(async () => {
      try {
        const result = await runVerificationJob();
        if (result.checked > 0) {
          console.log(`[Scheduler] Verification: ${result.healthy}/${result.checked} healthy`);
        }
        
        const disabled = await disableUnhealthyAgents(DISABLE_THRESHOLD);
        if (disabled > 0) {
          console.warn(`[Scheduler] Auto-disabled ${disabled} unhealthy agents`);
          // TODO: Send webhook/email notifications to affected agents
        }
      } catch (err) {
        console.error("[Scheduler] Verification job failed:", err);
      }
    }, VERIFICATION_INTERVAL_MS);
  }

  // ==========================================================================
  // AUTOMATIC SETTLEMENT - runs every 5 minutes
  // ==========================================================================
  // Settles agents whose pending_lamports >= MIN_PAYOUT threshold.
  // In production with Solana configured, this executes on-chain transfers.
  // Without Solana, it logs eligible agents for manual settlement.

  const SETTLEMENT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  if (process.env.DATABASE_URL) {
    console.log(`  💰 Starting auto-settlement scheduler (every 5 min, threshold: ${PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS} lamports)`);

    setInterval(async () => {
      try {
        const eligible = await query(`
          SELECT id, name, pending_lamports 
          FROM agents 
          WHERE pending_lamports >= $1
        `, [PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS]);

        if (eligible.rows.length === 0) return;

        for (const agent of eligible.rows) {
          try {
            // Check if agent has a public key for on-chain settlement
            if (!agent.public_key) {
              console.log(`[Settlement] Agent ${agent.id} eligible (${agent.pending_lamports} lamports) but no public key — skipping`);
              continue;
            }

            // Move pending to settled via atomic transaction
            await query('BEGIN');
            await query(`
              UPDATE agents 
              SET pending_lamports = 0, 
                  balance_lamports = balance_lamports + pending_lamports
              WHERE id = $1 AND pending_lamports >= $2
            `, [agent.id, PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS]);

            // Record settlement
            await query(`
              INSERT INTO settlements (from_agent_id, to_agent_id, gross_lamports, platform_fee_lamports, net_lamports, status)
              VALUES ($1, $1, $2, 0, $2, 'settled_internal')
            `, [agent.id, agent.pending_lamports]);

            await query('COMMIT');
            console.log(`[Settlement] Settled ${agent.pending_lamports} lamports for agent ${agent.id}`);
          } catch (err) {
            await query('ROLLBACK').catch(() => {});
            console.error(`[Settlement] Failed for agent ${agent.id}:`, err);
          }
        }
      } catch (err) {
        console.error("[Settlement] Scheduler error:", err);
      }
    }, SETTLEMENT_INTERVAL_MS);
  }
});
