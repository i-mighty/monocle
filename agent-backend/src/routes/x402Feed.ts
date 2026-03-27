/**
 * x402 Transaction Feed Routes
 *
 * SSE endpoint that streams real-time x402 payment events to the dashboard.
 * Also provides REST endpoint for recent transaction history.
 */

import { Router, Request, Response } from "express";
import { x402Events, getRecentTransactions, type X402Event } from "../services/x402PaymentService";
import { x402Enabled } from "../middleware/x402Official";

const router = Router();

// =============================================================================
// GET /x402-feed/stream — Server-Sent Events (live transaction feed)
// =============================================================================

router.get("/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Send initial status
  const statusData = {
    type: "status",
    x402Enabled,
    timestamp: new Date().toISOString(),
    network: process.env.SOLANA_NETWORK === "mainnet" ? "solana-mainnet" : "solana-devnet",
  };
  res.write(`data: ${JSON.stringify(statusData)}\n\n`);

  // Stream events
  const handler = (event: X402Event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  x402Events.on("x402", handler);

  // Clean up on disconnect
  req.on("close", () => {
    x402Events.off("x402", handler);
  });
});

// =============================================================================
// GET /x402-feed/recent — Recent transactions (REST)
// =============================================================================

router.get("/recent", async (_req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(_req.query.limit) || "50", 10), 200);
  const transactions = await getRecentTransactions(limit);
  res.json({
    x402Enabled,
    network: process.env.SOLANA_NETWORK === "mainnet" ? "solana-mainnet" : "solana-devnet",
    count: transactions.length,
    transactions,
  });
});

// =============================================================================
// GET /x402-feed/status — x402 integration status
// =============================================================================

router.get("/status", (_req: Request, res: Response) => {
  res.json({
    x402Enabled,
    network: process.env.SOLANA_NETWORK === "mainnet" ? "solana-mainnet" : "solana-devnet",
    payTo: process.env.X402_PAY_TO || process.env.PLATFORM_WALLET || null,
    facilitator: process.env.X402_FACILITATOR_URL || "https://facilitator.x402.org",
    chatPrice: process.env.X402_CHAT_PRICE || "0.001",
    clientConfigured: !!process.env.X402_CLIENT_PRIVATE_KEY,
  });
});

export default router;
