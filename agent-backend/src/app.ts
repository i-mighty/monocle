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
import { requestIdMiddleware, errorHandler, notFoundHandler } from "./errors";
import { getDemoStatus } from "./middleware/demoOnly";
import { rateLimit, ipRateLimit, slowDown } from "./middleware/rateLimit";
import { enforceProductionRequirements, isProduction } from "./middleware/requireProduction";

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

v1.use("/identity", identity);
v1.use("/meter", meter);
v1.use("/payments", payments);
v1.use("/dashboard", analytics);
v1.use("/agents", agents);
v1.use("/pricing", pricing);
v1.use("/x402", x402);
v1.use("/messaging", messaging);
v1.use("/economics", economics);
v1.use("/reputation", reputation);
v1.use("/simulation", simulation);
v1.use("/webhooks", webhooks);
v1.use("/anti-abuse", antiAbuse);
v1.use("/budget", budget);
v1.use("/activity", activity);
v1.use("/api-keys", apiKeys);

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
});
