/**
 * x402 Payment Service
 *
 * Provides:
 * 1. Event emitter for x402 payment lifecycle events (for SSE feed)
 * 2. x402 paying client (wraps fetch with automatic 402 handling)
 * 3. Transaction logging to database
 */

import { EventEmitter } from "events";
import { query } from "../db/client";

// =============================================================================
// EVENT BUS — streams payment events to SSE clients
// =============================================================================

export interface X402Event {
  type: "payment_required" | "payment_created" | "payment_settled" | "payment_failed";
  timestamp: string;
  path?: string;
  method?: string;
  network?: string;
  payer?: string;
  amount?: string;
  txSignature?: string;
  settleResponse?: string | null;
  error?: string;
  agentId?: string;
  agentName?: string;
}

class X402EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // SSE clients
  }
}

export const x402Events = new X402EventBus();

/**
 * Emit an x402 payment event and persist to DB
 */
export function emitX402Event(event: X402Event): void {
  x402Events.emit("x402", event);

  // Persist to x402_payments table (fire-and-forget)
  persistEvent(event).catch((err) =>
    console.error("[x402] Failed to persist event:", err.message)
  );
}

async function persistEvent(event: X402Event): Promise<void> {
  try {
    await query(
      `INSERT INTO x402_payments 
       (tx_signature, payer_address, amount_lamports, status, network, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.txSignature || null,
        event.payer || null,
        event.amount ? parseInt(event.amount, 10) : 0,
        event.type,
        event.network || "solana-devnet",
        JSON.stringify({
          path: event.path,
          method: event.method,
          settleResponse: event.settleResponse,
          agentId: event.agentId,
          agentName: event.agentName,
          error: event.error,
        }),
      ]
    );
  } catch {
    // Table might not exist yet — silent fail
  }
}

// =============================================================================
// x402 PAYING CLIENT — for agent-to-agent calls
// =============================================================================

/**
 * Create a payment-enabled fetch function that automatically handles
 * HTTP 402 responses by signing Solana transactions.
 *
 * Requires a Solana private key to sign payment transactions.
 * If no key is configured, returns standard fetch (no auto-pay).
 */
export async function createPayingFetch(): Promise<typeof globalThis.fetch> {
  const privateKeyEnv = process.env.X402_CLIENT_PRIVATE_KEY;
  if (!privateKeyEnv) {
    console.log("[x402] No X402_CLIENT_PRIVATE_KEY — paying client disabled, using standard fetch");
    return globalThis.fetch;
  }

  try {
    // Dynamic imports to avoid loading Solana deps when not configured
    const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
    const { ExactSvmScheme } = await import("@x402/svm");
    const { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2 } = await import("@x402/svm");
    const { createKeyPairSignerFromBytes } = await import("@solana/kit");

    // Parse private key (supports JSON byte array, hex, or base58)
    let keyBytes: Uint8Array;
    if (privateKeyEnv.startsWith("[")) {
      const parsed = JSON.parse(privateKeyEnv) as number[];
      keyBytes = new Uint8Array(parsed);
    } else if (/^[0-9a-fA-F]{128}$/.test(privateKeyEnv)) {
      // 64-byte hex-encoded secret key
      keyBytes = new Uint8Array(Buffer.from(privateKeyEnv, "hex"));
    } else {
      // Base58 encoded
      const bs58 = await import("bs58");
      keyBytes = bs58.default.decode(privateKeyEnv);
    }

    const signer = await createKeyPairSignerFromBytes(keyBytes);

    const network: string = process.env.SOLANA_NETWORK === "mainnet"
      ? SOLANA_MAINNET_CAIP2
      : SOLANA_DEVNET_CAIP2;

    const client = new x402Client()
      .register(network, new ExactSvmScheme(signer));

    const payingFetch = wrapFetchWithPayment(globalThis.fetch, client);

    // Wrap to emit events on payment
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      const response = await payingFetch(input, init);

      // Check if payment was made (response will have settlement headers)
      const settleHeaderRaw = response.headers.get("payment-response") || response.headers.get("x-payment-response");
      if (settleHeaderRaw) {
        try {
          let decoded: string;
          try { decoded = Buffer.from(settleHeaderRaw, "base64").toString(); } catch { decoded = settleHeaderRaw; }
          const settle = JSON.parse(decoded);
          emitX402Event({
            type: "payment_settled",
            timestamp: new Date().toISOString(),
            path: url,
            method: init?.method || "GET",
            network: network as string,
            txSignature: settle.transaction,
            payer: settle.payer,
            amount: settle.amount,
          });
        } catch {
          // Header parsing failed, still emit basic event
          emitX402Event({
            type: "payment_settled",
            timestamp: new Date().toISOString(),
            path: url,
            method: init?.method || "GET",
            network: network as string,
            settleResponse: settleHeaderRaw,
          });
        }
      }

      return response;
    };
  } catch (err) {
    console.error("[x402] Failed to create paying client:", (err as Error).message);
    return globalThis.fetch;
  }
}

// =============================================================================
// RECENT TRANSACTIONS QUERY
// =============================================================================

export async function getRecentTransactions(limit: number = 50): Promise<X402Event[]> {
  try {
    const result = await query(
      `SELECT tx_signature, payer_address, amount_lamports, status, network, metadata, created_at
       FROM x402_payments
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row: any) => {
      const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata || {});
      return {
        type: row.status,
        timestamp: row.created_at?.toISOString() || new Date().toISOString(),
        txSignature: row.tx_signature,
        payer: row.payer_address,
        amount: String(row.amount_lamports || 0),
        network: row.network,
        path: meta.path,
        method: meta.method,
        agentId: meta.agentId,
        agentName: meta.agentName,
        error: meta.error,
      };
    });
  } catch {
    return [];
  }
}
