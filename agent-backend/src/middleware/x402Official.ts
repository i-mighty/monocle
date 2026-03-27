/**
 * Official x402 SDK Middleware
 *
 * Wraps @x402/express + @x402/svm to protect endpoints with real
 * Solana USDC micropayments using the x402 HTTP 402 protocol.
 *
 * Flow:
 * 1. Client hits a protected route
 * 2. Middleware returns 402 + payment requirements (USDC on Solana)
 * 3. Client signs a Solana transaction via @x402/fetch
 * 4. Client retries with X-PAYMENT header
 * 5. Facilitator verifies + settles on-chain
 * 6. Request is served
 */

import { Request, Response, NextFunction } from "express";
import {
  paymentMiddlewareFromConfig,
  x402ResourceServer,
  type SchemeRegistration,
} from "@x402/express";
import {
  ExactSvmScheme as ExactSvmSchemeServer,
} from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2 } from "@x402/svm";
import { x402Events, emitX402Event } from "../services/x402PaymentService";

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Platform wallet that receives USDC payments */
const PLATFORM_WALLET = process.env.X402_PAY_TO || process.env.PLATFORM_WALLET || "";

/** Solana network (CAIP-2) */
const NETWORK: Network = process.env.SOLANA_NETWORK === "mainnet"
  ? SOLANA_MAINNET_CAIP2
  : SOLANA_DEVNET_CAIP2;

/** Default price per chat request in USDC (string decimal) */
const DEFAULT_CHAT_PRICE = process.env.X402_CHAT_PRICE || "0.001"; // $0.001

/** Whether x402 is fully enabled (requires wallet + facilitator) */
export const x402Enabled = !!PLATFORM_WALLET;

// =============================================================================
// ROUTE CONFIGURATION
// =============================================================================

/**
 * Build RoutesConfig for x402 protected endpoints.
 * Each key is an Express path pattern, value defines the payment option.
 */
function buildRoutes() {
  if (!PLATFORM_WALLET) return {};

  // Route keys use req.path as seen inside the v1 router (no /v1 prefix)
  return {
    "POST /chat": {
      accepts: {
        scheme: "exact",
        network: NETWORK,
        payTo: PLATFORM_WALLET,
        price: DEFAULT_CHAT_PRICE,
        maxTimeoutSeconds: 120,
      },
      description: "AI chat request routed through Monocle",
      mimeType: "application/json",
    },
    "POST /chat/stream": {
      accepts: {
        scheme: "exact",
        network: NETWORK,
        payTo: PLATFORM_WALLET,
        price: DEFAULT_CHAT_PRICE,
        maxTimeoutSeconds: 120,
      },
      description: "Streaming AI chat request routed through Monocle",
      mimeType: "text/event-stream",
    },
    "POST /x402/execute": {
      accepts: {
        scheme: "exact",
        network: NETWORK,
        payTo: PLATFORM_WALLET,
        price: DEFAULT_CHAT_PRICE,
        maxTimeoutSeconds: 60,
      },
      description: "Execute a paid tool call",
      mimeType: "application/json",
    },
  };
}

// =============================================================================
// MIDDLEWARE FACTORY
// =============================================================================

let _middleware: ((req: Request, res: Response, next: NextFunction) => Promise<void>) | null = null;

/**
 * Get or create the x402 payment middleware singleton.
 * Returns null if x402 is not configured (no wallet).
 */
export function getX402Middleware(): ((req: Request, res: Response, next: NextFunction) => Promise<void>) | null {
  if (!x402Enabled) {
    console.log("[x402] Disabled — no X402_PAY_TO wallet configured");
    return null;
  }

  if (_middleware) return _middleware;

  const routes = buildRoutes();
  const facilitatorUrl = process.env.X402_FACILITATOR_URL || "https://facilitator.x402.org";

  // SVM scheme for the server side (price parsing, payment requirements)
  const svmSchemeServer = new ExactSvmSchemeServer();
  const schemes: SchemeRegistration[] = [
    { network: NETWORK, server: svmSchemeServer },
  ];

  // Facilitator client handles verify + settle
  const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });

  console.log(`[x402] Enabled — network=${NETWORK}, payTo=${PLATFORM_WALLET.slice(0, 8)}..., facilitator=${facilitatorUrl}`);

  _middleware = paymentMiddlewareFromConfig(
    routes,
    facilitator,
    schemes,
    undefined, // no paywall config
    undefined, // no custom paywall
    true,      // sync facilitator on start to fetch supported payment kinds
  );

  return _middleware;
}

/**
 * Express middleware that applies x402 payment protection.
 * If x402 is not configured, requests pass through freely.
 */
export function x402ProtectMiddleware(req: Request, res: Response, next: NextFunction) {
  const mw = getX402Middleware();
  if (!mw) return next();

  // Wrap to capture settlement events
  const originalJson = res.json.bind(res);
  const originalEnd = res.end.bind(res);

  // After the middleware runs, check if payment was made
  const paymentHeader = req.header("X-PAYMENT") || req.header("x-payment");

  mw(req, res, (err?: any) => {
    if (err) return next(err);

    // If we got here with a payment header, the payment was verified+settled
    if (paymentHeader) {
      const settleHeader = res.getHeader("X-PAYMENT-RESPONSE") as string | undefined;

      // Try to extract tx signature from the settle response header
      let txSignature: string | undefined;
      if (settleHeader) {
        try {
          const settle = JSON.parse(settleHeader);
          txSignature = settle.transaction || settle.txSignature;
        } catch {
          // not JSON, ignore
        }
      }

      // Attach tx signature to request so downstream handlers can include it
      (req as any).x402TxSignature = txSignature || null;

      emitX402Event({
        type: "payment_settled",
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
        network: NETWORK as string,
        txSignature,
        settleResponse: settleHeader || null,
      });
    }

    next();
  });
}
