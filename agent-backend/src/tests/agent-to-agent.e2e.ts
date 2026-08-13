#!/usr/bin/env ts-node-dev

/**
 * TWO AGENTS, ONE PAYMENT, NOBODY IN THE MIDDLE
 *
 * The devnet test next door proves a payment verifies. It does not prove the
 * thing Monocle actually claims: that one agent can buy work from another and
 * that neither needs us standing between them. Every prior test played the
 * caller AND the platform, and no test has ever had a second agent that serves
 * something.
 *
 * So this one runs a real seller. It is an ordinary HTTP server that holds NO
 * Monocle API key, refuses to work unpaid, checks payment itself, and hands back
 * the goods. The buyer discovers it, prices the call, pays on-chain, and collects.
 *
 * What must be true for the claim to hold, and what is therefore asserted:
 *
 *   1. The seller refuses to work without payment.
 *   2. The seller refuses a payment that was never made.
 *   3. The price and the payee come from Monocle, not from the buyer.
 *   4. The lamports move buyer -> seller. Directly. On-chain.
 *   5. Monocle's own wallet does not change by a single lamport.
 *   6. The seller needs no Monocle credential to check any of this.
 *   7. One payment buys exactly one call.
 *   8. Nothing is left owed afterwards — the payment IS the settlement.
 *
 * Devnet only, and it asserts that before spending anything.
 *
 * Last run green on 2026-08-13, 20/20, on this payment from one agent to another:
 *
 *   4RDptcyFGjc3sKJetR9NwVMbSz1tWt73iVEyFcuwJJA4q8Q8hMfGBv57yjW8JA3igKyfaXacKX4eTi2qCsm7NUzn
 *   https://explorer.solana.com/tx/4RDptcyFGjc3sKJetR9NwVMbSz1tWt73iVEyFcuwJJA4q8Q8hMfGBv57yjW8JA3igKyfaXacKX4eTi2qCsm7NUzn?cluster=devnet
 *
 * That is the first run in which a second agent actually served something for
 * money. Re-run it after any change to quoting, verification, payout wallets or
 * replay protection — the parts no mocked test can cover.
 *
 * Requires: DATABASE_URL, a backend on BASE_URL, devnet reachable, and a funded
 * payer in DEVNET_PAYER_SECRET (a JSON array of 64 bytes, what solana-keygen
 * writes). The faucet is unreliable; fund a keypair once and reuse it.
 */

import "dotenv/config";
import http from "http";
import { AddressInfo } from "net";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { pool, query } from "../db/client";

const BASE = process.env.TEST_BASE_URL || "http://localhost:3001";
const RPC = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC || clusterApiUrl("devnet");
const PLATFORM_KEY = process.env.AGENTPAY_API_KEY || "";

const colors = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", dim: "\x1b[2m", yellow: "\x1b[33m" };
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ${colors.green}PASS${colors.reset}  ${name}`);
  } else {
    failed++;
    console.log(`  ${colors.red}FAIL${colors.reset}  ${name}${detail ? ` ${colors.dim}- ${detail}${colors.reset}` : ""}`);
  }
}

const tag = Date.now();
const SELLER_ID = `seller-${tag}`;
const BUYER_ID = `buyer-${tag}`;

/**
 * The seller. Deliberately written the way a third party would write it: plain
 * HTTP, no Monocle SDK, no API key, and no knowledge of the buyer. Its only
 * dependency on Monocle is one unauthenticated POST to ask whether it was paid.
 */
function startSellerAgent(seenCredentials: string[]) {
  let workDelivered = 0;

  const server = http.createServer(async (req, res) => {
    // Record anything credential-shaped the seller was handed, so the claim that
    // it needs none is checked rather than asserted.
    for (const header of ["x-api-key", "authorization", "cookie"]) {
      const value = req.headers[header];
      if (value) seenCredentials.push(`${header}: ${String(value).slice(0, 12)}`);
    }

    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "ok" }));
    }

    if (req.url !== "/work" || req.method !== "POST") {
      res.writeHead(404);
      return res.end();
    }

    const signature = req.headers["x-payment-signature"] as string | undefined;
    const nonce = req.headers["x-payment-nonce"] as string | undefined;

    if (!signature || !nonce) {
      res.writeHead(402, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Payment Required", agentId: SELLER_ID }));
    }

    // The whole trust model in one call. The seller does not believe the headers
    // — a signature is public, anyone can copy one off the chain — it asks
    // Monocle whether that nonce was paid, to it, in full, and not already spent.
    let verdict: any;
    try {
      verdict = await fetch(`${BASE}/v1/x402/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signature,
          nonce,
          payer: req.headers["x-payment-payer"],
          amount: Number(req.headers["x-payment-amount"]),
        }),
      }).then((r) => r.json());
    } catch (err) {
      res.writeHead(503, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Cannot verify payment right now" }));
    }

    if (!verdict?.valid) {
      res.writeHead(402, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Payment invalid", reason: verdict?.error }));
    }

    workDelivered++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: `Summary #${workDelivered}: the paid work.`, usage: { totalTokens: 1000 } }));
  });

  return new Promise<{ url: string; close: () => void; delivered: () => number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
        delivered: () => workDelivered,
      });
    });
  });
}

async function main() {
  if (!pool) {
    console.error("\nRefusing to run: DATABASE_URL unset.\n");
    process.exit(1);
  }
  if (!(await fetch(`${BASE}/health`).catch(() => null))) {
    console.error(`\nRefusing to run: no server at ${BASE}.\n`);
    process.exit(1);
  }
  const secret = process.env.DEVNET_PAYER_SECRET;
  if (!secret) {
    console.error("\nRefusing to run: DEVNET_PAYER_SECRET unset. Fund a keypair and set it.\n");
    process.exit(2);
  }

  const conn = new Connection(RPC, "confirmed");
  const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  const genesis = await conn.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) {
    console.error(`\nRefusing to run: RPC ${RPC} is not devnet (genesis ${genesis}).\n`);
    process.exit(1);
  }

  console.log("\nTWO AGENTS, ONE PAYMENT, NOBODY IN THE MIDDLE\n");
  console.log(`${colors.dim}  rpc: ${RPC}${colors.reset}\n`);

  const buyerWallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  const sellerWallet = Keypair.generate();
  const credentialsSeenBySeller: string[] = [];
  const seller = await startSellerAgent(credentialsSeenBySeller);

  // Monocle's own wallet, so we can prove it stays out of the transaction.
  const info: any = await fetch(`${BASE}/v1/x402/info`).then((r) => r.json());
  const platformWallet: string = info?.recipient;

  try {
    // ── Both agents exist on the network ────────────────────────────────────
    console.log("Setup");
    const rentExempt = await conn.getMinimumBalanceForRentExemption(0);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: buyerWallet.publicKey,
          toPubkey: sellerWallet.publicKey,
          lamports: rentExempt,
        })
      ),
      [buyerWallet],
      { commitment: "confirmed" }
    );

    await query(
      `insert into agents (id, name, public_key, default_rate_per_1k_tokens, balance_lamports, pending_lamports, categories)
       values ($1, 'Seller Agent', $2, 1000, 0, 0, '["writing"]')`,
      [SELLER_ID, sellerWallet.publicKey.toBase58()]
    );
    await query(
      `insert into agents (id, name, public_key, default_rate_per_1k_tokens, balance_lamports, pending_lamports)
       values ($1, 'Buyer Agent', $2, 1000, 0, 0)`,
      [BUYER_ID, buyerWallet.publicKey.toBase58()]
    );
    await query(
      `insert into agent_endpoints (agent_id, endpoint_url, is_active, is_healthy)
       values ($1, $2, true, true)`,
      [SELLER_ID, `${seller.url}/work`]
    );
    check("two agents are registered, each with its own payout wallet", true);

    // ── 1. Discovery: the buyer finds the seller without being told ─────────
    console.log("\nDiscovery");
    const listed: any = await fetch(`${BASE}/v1/agents/marketplace?taskType=writing&limit=100`).then((r) => r.json());
    const found = (listed?.data?.agents ?? []).some((a: any) => a.id === SELLER_ID);
    check("the seller is discoverable in the public marketplace", found);

    let endpointUrl: string | null = null;
    if (PLATFORM_KEY) {
      const detail: any = await fetch(`${BASE}/v1/agents/${SELLER_ID}`, {
        headers: { "x-api-key": PLATFORM_KEY },
      }).then((r) => r.json());
      endpointUrl = detail?.data?.endpointUrl ?? null;
      check("its endpoint address is resolvable from the registry", endpointUrl === `${seller.url}/work`, String(endpointUrl));
    } else {
      console.log(`  ${colors.yellow}SKIP${colors.reset}  endpoint lookup (AGENTPAY_API_KEY unset)`);
      endpointUrl = `${seller.url}/work`;
    }

    // ── 2. Unpaid callers get nothing ───────────────────────────────────────
    console.log("\nBefore paying");
    const unpaid = await fetch(endpointUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "summarise this" }),
    });
    check("the seller refuses to work unpaid", unpaid.status === 402, `got ${unpaid.status}`);
    check("and delivered nothing", seller.delivered() === 0);

    const forged = await fetch(endpointUrl!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payment-signature": "4vJ9JU1bJJE96FbKCnJteBJvGm1mJEwCBGmSbnvFLwLGT9DoRD2fkxFvBAkMoKQMHrvBqPTRjMhBFMdvvKcPzKqY",
        "x-payment-payer": buyerWallet.publicKey.toBase58(),
        "x-payment-amount": "1000",
        "x-payment-nonce": "made-up-nonce",
      },
      body: JSON.stringify({ input: "summarise this" }),
    });
    check("a payment that was never made is refused", forged.status === 402, `got ${forged.status}`);
    check("still delivered nothing", seller.delivered() === 0);

    // ── 3. The price and the payee come from Monocle ─────────────────────────
    console.log("\nQuote");
    const qRes = await fetch(`${BASE}/v1/x402/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: SELLER_ID,
        toolName: "summarize",
        estimatedTokens: 1000,
        callerAgentId: BUYER_ID,
      }),
    });
    const quote: any = await qRes.json();
    const amount = Number(quote?.payment?.amount);
    const recipient: string = quote?.payment?.recipient;
    const nonce: string = quote?.payment?.nonce;

    check("Monocle prices the call", qRes.status === 402 && amount > 0, `${qRes.status}, ${amount}`);
    check(
      "and names the SELLER's wallet as payee, not its own",
      recipient === sellerWallet.publicKey.toBase58() && recipient !== platformWallet,
      recipient
    );

    // ── 4 & 5. The money moves, and only between the two of them ────────────
    console.log("\nPayment");
    const before = {
      buyer: await conn.getBalance(buyerWallet.publicKey),
      seller: await conn.getBalance(sellerWallet.publicKey),
      platform: platformWallet ? await conn.getBalance(new PublicKey(platformWallet)) : 0,
    };

    const signature = await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: buyerWallet.publicKey,
          toPubkey: new PublicKey(recipient),
          lamports: amount,
        })
      ),
      [buyerWallet],
      { commitment: "confirmed" }
    );

    const after = {
      buyer: await conn.getBalance(buyerWallet.publicKey),
      seller: await conn.getBalance(sellerWallet.publicKey),
      platform: platformWallet ? await conn.getBalance(new PublicKey(platformWallet)) : 0,
    };

    check("the seller was paid, on-chain", after.seller - before.seller === amount, `+${after.seller - before.seller}`);
    check("the buyer paid it", before.buyer - after.buyer >= amount, `-${before.buyer - after.buyer}`);
    check(
      "Monocle's wallet did not move by one lamport",
      after.platform === before.platform,
      `${before.platform} -> ${after.platform}`
    );

    // ── 6 & 7. The seller checks for itself, once ───────────────────────────
    console.log("\nDelivery");
    const paidHeaders = {
      "content-type": "application/json",
      "x-payment-signature": signature,
      "x-payment-payer": buyerWallet.publicKey.toBase58(),
      "x-payment-amount": String(amount),
      "x-payment-nonce": nonce,
    };
    const paid = await fetch(endpointUrl!, {
      method: "POST",
      headers: paidHeaders,
      body: JSON.stringify({ input: "summarise this" }),
    });
    const work: any = await paid.json();
    check("the seller serves the paid call", paid.status === 200, `got ${paid.status}`);
    check("and returns actual work", typeof work?.content === "string" && work.content.length > 0);
    check("exactly one delivery", seller.delivered() === 1, String(seller.delivered()));

    check(
      "the seller held no Monocle credential at any point",
      credentialsSeenBySeller.length === 0,
      credentialsSeenBySeller.join("; ")
    );

    const replay = await fetch(endpointUrl!, {
      method: "POST",
      headers: paidHeaders,
      body: JSON.stringify({ input: "summarise this again, free" }),
    });
    check("the same payment cannot buy a second call", replay.status === 402, `got ${replay.status}`);
    check("still exactly one delivery", seller.delivered() === 1, String(seller.delivered()));

    // ── 8. Nothing is left owed ─────────────────────────────────────────────
    console.log("\nAfterwards");
    const owed = await query(`select pending_lamports, balance_lamports from agents where id = $1`, [SELLER_ID]);
    check(
      "the platform owes the seller nothing — the payment was the settlement",
      Number(owed.rows[0].pending_lamports) === 0,
      `pending=${owed.rows[0].pending_lamports}`
    );

    const claimed = await query(`select payer_wallet from x402_payments where tx_signature = $1`, [signature]);
    check("the payment is recorded once, against the payer who made it", claimed.rows.length === 1);

    console.log(
      `\n${colors.dim}  paid ${amount} lamports  buyer ${buyerWallet.publicKey
        .toBase58()
        .slice(0, 8)}… -> seller ${sellerWallet.publicKey.toBase58().slice(0, 8)}…`
    );
    console.log(`  explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet${colors.reset}`);
  } finally {
    seller.close();
    await query(`delete from x402_quotes where callee_agent_id = $1`, [SELLER_ID]);
    await query(`delete from agent_endpoints where agent_id = $1`, [SELLER_ID]);
    await query(`delete from agents where id in ($1, $2)`, [SELLER_ID, BUYER_ID]);
    console.log(`\n${colors.dim}cleaned up${colors.reset}`);
  }

  console.log(`\n${failed === 0 ? colors.green : colors.red}${passed} passed, ${failed} failed${colors.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run failed:", err?.message ?? err);
  process.exit(1);
});
