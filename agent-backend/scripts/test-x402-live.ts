/**
 * Live x402 Payment Test
 *
 * Tests the full 402 → pay → settle flow against the running backend.
 * Uses the same wallet configured in .env to pay for a chat request.
 *
 * Usage:
 *   cd agent-backend
 *   npx ts-node scripts/test-x402-live.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const API_BASE = process.env.API_BASE || "http://localhost:3001";
const API_KEY = process.env.AGENTPAY_API_KEY || "test_key_12345";

// ─── Colors ──────────────────────────────────────────────────────────────────
const R = "\x1b[31m", G = "\x1b[32m", Y = "\x1b[33m", B = "\x1b[34m",
      M = "\x1b[35m", C = "\x1b[36m", W = "\x1b[37m", DIM = "\x1b[2m", 
      BOLD = "\x1b[1m", RST = "\x1b[0m";

function log(prefix: string, color: string, msg: string) {
  console.log(`${color}${BOLD}[${prefix}]${RST} ${msg}`);
}

async function main() {
  console.log(`\n${BOLD}${C}═══════════════════════════════════════════════════${RST}`);
  console.log(`${BOLD}${C}  Monocle x402 Live Payment Test${RST}`);
  console.log(`${BOLD}${C}═══════════════════════════════════════════════════${RST}\n`);

  // ── Step 0: Check server health ─────────────────────────────────────────
  log("HEALTH", B, `Checking ${API_BASE}/health ...`);
  const healthResp = await fetch(`${API_BASE}/health`);
  const health = await healthResp.json() as any;
  log("HEALTH", health.status === "healthy" ? G : R, `Status: ${health.status}`);

  // ── Step 1: Check x402 status ───────────────────────────────────────────
  log("X402", B, "Checking x402 configuration...");
  const statusResp = await fetch(`${API_BASE}/v1/x402-feed/status`);
  const status = await statusResp.json() as any;
  log("X402", status.x402Enabled ? G : R,
    `Enabled: ${status.x402Enabled}, Network: ${status.network}, Wallet: ${status.payTo?.slice(0, 12)}...`);

  if (!status.x402Enabled) {
    log("ABORT", R, "x402 is not enabled. Set X402_PAY_TO in .env and restart.");
    process.exit(1);
  }

  // ── Step 2: Make unpaid request → expect 402 ────────────────────────────
  log("TEST 1", Y, "Sending unpaid POST /v1/chat → expecting 402...");
  const unpaidResp = await fetch(`${API_BASE}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ message: "hello", conversationId: "test-x402-live" }),
  });

  log("TEST 1", unpaidResp.status === 402 ? G : R,
    `Status: ${unpaidResp.status} ${unpaidResp.statusText}`);

  if (unpaidResp.status === 402) {
    const paymentHeader = unpaidResp.headers.get("payment-required") || unpaidResp.headers.get("PAYMENT-REQUIRED");
    if (paymentHeader) {
      const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
      log("402", M, `x402 Version: ${decoded.x402Version}`);
      log("402", M, `Resource: ${decoded.resource?.url}`);
      log("402", M, `Description: ${decoded.resource?.description}`);
      if (decoded.accepts?.[0]) {
        const a = decoded.accepts[0];
        log("402", M, `Scheme: ${a.scheme}, Network: ${a.network}`);
        log("402", M, `Amount: ${a.amount} (${parseInt(a.amount) / 1_000_000} USDC)`);
        log("402", M, `Pay To: ${a.payTo}`);
        log("402", M, `Asset (USDC): ${a.asset}`);
        if (a.extra?.feePayer) {
          log("402", DIM, `Fee Payer (facilitator): ${a.extra.feePayer}`);
        }
      }
    }
  } else {
    log("WARN", Y, "Expected 402 but got " + unpaidResp.status + ". x402 middleware may not be matching this route.");
  }

  // ── Step 3: Make PAID request using @x402/fetch ─────────────────────────
  log("TEST 2", Y, "Creating paying client with @x402/fetch...");

  const privateKeyEnv = process.env.X402_CLIENT_PRIVATE_KEY;
  if (!privateKeyEnv) {
    log("ABORT", R, "No X402_CLIENT_PRIVATE_KEY in .env — can't sign payments.");
    process.exit(1);
  }

  try {
    const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
    const { ExactSvmScheme, SOLANA_DEVNET_CAIP2 } = await import("@x402/svm");
    const { createKeyPairSignerFromBytes } = await import("@solana/kit");

    // Parse private key
    let keyBytes: Uint8Array;
    if (privateKeyEnv.startsWith("[")) {
      keyBytes = new Uint8Array(JSON.parse(privateKeyEnv) as number[]);
    } else {
      const bs58 = await import("bs58");
      keyBytes = bs58.default.decode(privateKeyEnv);
    }

    const signer = await createKeyPairSignerFromBytes(keyBytes);
    log("TEST 2", G, `Signer loaded: ${signer.address}`);

    const client = new x402Client()
      .register(SOLANA_DEVNET_CAIP2, new ExactSvmScheme(signer));

    const payingFetch = wrapFetchWithPayment(globalThis.fetch, client);

    // ── Send the paid request ───────────────────────────────────────────
    log("TEST 2", Y, `Sending PAID POST /v1/chat → expect 200 with tx settlement...`);
    console.log(`${DIM}  (This will sign a real Solana devnet transaction)${RST}\n`);

    const paidResp = await payingFetch(`${API_BASE}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({
        message: "What is x402? Answer in one sentence.",
        conversationId: "test-x402-paid",
      }),
    });

    log("TEST 2", paidResp.status === 200 ? G : R,
      `Status: ${paidResp.status} ${paidResp.statusText}`);

    // Dump all response headers
    log("HEADERS", DIM, "Response headers:");
    paidResp.headers.forEach((value, key) => {
      log("HEADERS", DIM, `  ${key}: ${value.slice(0, 120)}`);
    });

    // Check settlement headers
    const settleHeaderRaw = paidResp.headers.get("payment-response") || paidResp.headers.get("x-payment-response");
    if (settleHeaderRaw) {
      try {
        // Header may be base64-encoded JSON
        let decoded: string;
        try { decoded = Buffer.from(settleHeaderRaw, "base64").toString(); } catch { decoded = settleHeaderRaw; }
        const settle = JSON.parse(decoded);
        log("SETTLED", G, `✅ Payment settled on-chain!`);
        if (settle.transaction || settle.txSignature) {
          const txSig = settle.transaction || settle.txSignature;
          log("TX", G, `Signature: ${txSig}`);
          log("TX", C, `Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
        }
        if (settle.payer) log("SETTLED", DIM, `Payer: ${settle.payer}`);
        if (settle.amount) log("SETTLED", DIM, `Amount: ${settle.amount}`);
      } catch {
        log("SETTLED", Y, `Raw settle header: ${settleHeaderRaw.slice(0, 200)}`);
      }
    } else {
      log("WARN", Y, "No payment-response header found on response");
    }

    // Print the chat response
    if (paidResp.status === 200) {
      const body = await paidResp.json() as any;
      log("RESPONSE", W, `Agent: ${body.response?.slice(0, 200) || JSON.stringify(body).slice(0, 200)}`);
    } else {
      const text = await paidResp.text();
      log("ERROR", R, text.slice(0, 500));
    }

  } catch (err: any) {
    log("ERROR", R, `Payment test failed: ${err.message}`);
    if (err.message.includes("insufficient")) {
      log("HINT", Y, "Wallet may need funding. Get devnet USDC from https://faucet.circle.com");
    }
    if (err.stack) console.log(`${DIM}${err.stack}${RST}`);
  }

  // ── Step 4: Check recent transactions ──────────────────────────────────
  log("FEED", B, "Checking recent x402 transactions...");
  try {
    const recentResp = await fetch(`${API_BASE}/v1/x402-feed/recent`);
    const recent = await recentResp.json() as any;
    if (recent.transactions?.length) {
      log("FEED", G, `${recent.transactions.length} recent transaction(s)`);
      for (const tx of recent.transactions.slice(0, 3)) {
        log("FEED", DIM, `  ${tx.type} | ${tx.txSignature?.slice(0, 16) || "no-sig"}... | ${tx.timestamp}`);
      }
    } else {
      log("FEED", DIM, "No transactions recorded yet");
    }
  } catch {
    log("FEED", DIM, "Transaction feed not available");
  }

  console.log(`\n${BOLD}${C}═══════════════════════════════════════════════════${RST}`);
  console.log(`${BOLD}${C}  Test complete${RST}`);
  console.log(`${BOLD}${C}═══════════════════════════════════════════════════${RST}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
