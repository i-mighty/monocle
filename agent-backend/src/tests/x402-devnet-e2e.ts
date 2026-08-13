#!/usr/bin/env ts-node-dev

/**
 * X402 END TO END ON SOLANA DEVNET
 *
 * A real payment: airdrop to a payer, quote a call, transfer the quoted lamports
 * on-chain to the agent's payout wallet, then submit the signature for
 * verification. Everything until now used fabricated signatures, which the
 * on-chain lookup rejects before the recipient check is ever reached — so the
 * recipient logic and the amount check have never actually run against a real
 * transaction.
 *
 * Devnet only, and it asserts that: a mistake here should cost nothing.
 *
 * Last run green on 2026-08-13, 10/10, against this transaction:
 *
 *   5shMYZMBoYzLFReY2v21tX8L8WJMFkfWX4HYJYhQfF87opWsF8CVruRBinEeeDgx2wTzkWp3rL3wxurZUTGq3PKi
 *   https://explorer.solana.com/tx/5shMYZMBoYzLFReY2v21tX8L8WJMFkfWX4HYJYhQfF87opWsF8CVruRBinEeeDgx2wTzkWp3rL3wxurZUTGq3PKi?cluster=devnet
 *
 * That run is the first evidence the recipient and amount checks work against a
 * real transaction rather than a fabricated signature the on-chain lookup
 * rejects early. Worth re-running after any change to quoting, verification or
 * the payout wallet — those paths cannot be covered by a test that fakes the
 * chain.
 *
 * Requires: DATABASE_URL, a running backend on BASE_URL, and devnet reachable.
 * Funding: the public faucet rate-limits hard; set DEVNET_PAYER_SECRET to a
 * funded keypair instead.
 */

import "dotenv/config";
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
const AGENT_ID = `devnet-payee-${tag}`;

async function main() {
  if (!pool) {
    console.error("\nRefusing to run: DATABASE_URL unset.\n");
    process.exit(1);
  }
  if (!(await fetch(`${BASE}/health`).catch(() => null))) {
    console.error(`\nRefusing to run: no server at ${BASE}.\n`);
    process.exit(1);
  }

  const conn = new Connection(RPC, "confirmed");

  // Refuse to run anywhere but devnet. A real transfer on mainnet would move
  // real money, and this script exists to be run casually.
  const genesis = await conn.getGenesisHash();
  const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  if (genesis !== DEVNET_GENESIS) {
    console.error(`\nRefusing to run: RPC ${RPC} is not devnet (genesis ${genesis}).\n`);
    process.exit(1);
  }

  console.log("\nX402 END TO END — SOLANA DEVNET\n");
  console.log(`${colors.dim}  rpc: ${RPC}${colors.reset}\n`);

  const payer = Keypair.generate();
  const payee = Keypair.generate();

  try {
    // ── Fund ────────────────────────────────────────────────────────────────
    //
    // The public devnet faucet (api.devnet.solana.com) rate-limits hard and
    // frequently answers 429 or "Internal error", so the airdrop cannot be
    // depended on. Set DEVNET_PAYER_SECRET to a funded keypair — a JSON array of
    // 64 bytes, the format `solana-keygen` writes — and the airdrop is skipped.
    console.log("Funding");
    let fundedPayer = payer;
    const secret = process.env.DEVNET_PAYER_SECRET;
    if (secret) {
      fundedPayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
      console.log(`${colors.dim}  using DEVNET_PAYER_SECRET (${fundedPayer.publicKey.toBase58()})${colors.reset}`);
    } else {
      try {
        const sig = await conn.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL / 10);
        await conn.confirmTransaction(sig, "confirmed");
      } catch (err) {
        const why = String((err as Error).message).slice(0, 90);
        console.error(
          [
            "",
            `  ${colors.yellow}Devnet faucet unavailable${colors.reset} — ${why}`,
            "  Fund a keypair and re-run with DEVNET_PAYER_SECRET set. Nothing was charged.",
            "",
          ].join("\n")
        );
        process.exit(2);
      }
    }

    const bal = await conn.getBalance(fundedPayer.publicKey);
    if (bal < LAMPORTS_PER_SOL / 50) {
      console.error(
        `\n  Payer holds only ${bal} lamports — not enough to seed the payee and pay. Top it up.\n`
      );
      process.exit(2);
    }
    check("payer is funded", bal > 0, `${bal} lamports`);

    // The payee account must exist and be rent-exempt, or a tiny transfer into a
    // brand-new account is not a useful test of anything.
    const rentExempt = await conn.getMinimumBalanceForRentExemption(0);
    const seed = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fundedPayer.publicKey,
        toPubkey: payee.publicKey,
        lamports: rentExempt,
      })
    );
    await sendAndConfirmTransaction(conn, seed, [fundedPayer], { commitment: "confirmed" });
    check("payee account exists and is rent-exempt", (await conn.getBalance(payee.publicKey)) >= rentExempt);

    // ── Register an agent whose payout wallet is that account ────────────────
    await query(
      `insert into agents (id, name, public_key, default_rate_per_1k_tokens, balance_lamports, pending_lamports)
       values ($1, 'Devnet Payee', $2, 1000, 0, 0)`,
      [AGENT_ID, payee.publicKey.toBase58()]
    );

    // ── Quote ───────────────────────────────────────────────────────────────
    console.log("\nQuote");
    const qRes = await fetch(`${BASE}/v1/x402/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: AGENT_ID, toolName: "summarize", estimatedTokens: 1000 }),
    });
    const quote: any = await qRes.json();
    const recipient = quote?.payment?.recipient;
    const amount = Number(quote?.payment?.amount);
    const nonce = quote?.payment?.nonce;

    check("quote returns 402", qRes.status === 402, `got ${qRes.status}`);
    check(
      "recipient is the AGENT's wallet, not the platform",
      recipient === payee.publicKey.toBase58(),
      `got ${recipient}`
    );
    check("quote carries an amount and nonce", amount > 0 && !!nonce);

    // ── Pay, for real ───────────────────────────────────────────────────────
    console.log("\nOn-chain payment");
    const before = await conn.getBalance(new PublicKey(recipient));
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fundedPayer.publicKey,
        toPubkey: new PublicKey(recipient),
        lamports: amount,
      })
    );
    const paymentSig = await sendAndConfirmTransaction(conn, tx, [fundedPayer], { commitment: "confirmed" });
    const after = await conn.getBalance(new PublicKey(recipient));
    check("transfer confirmed on devnet", !!paymentSig, paymentSig.slice(0, 20) + "...");
    check("agent's wallet actually received it", after - before === amount, `+${after - before} lamports`);

    // ── Verify ──────────────────────────────────────────────────────────────
    console.log("\nVerification");
    const vRes = await fetch(`${BASE}/v1/x402/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signature: paymentSig,
        payer: fundedPayer.publicKey.toBase58(),
        amount,
        nonce,
      }),
    });
    const verdict: any = await vRes.json();
    check("a real payment verifies", verdict?.valid === true, JSON.stringify(verdict).slice(0, 140));

    // ── Replay ──────────────────────────────────────────────────────────────
    console.log("\nReplay");
    const rRes = await fetch(`${BASE}/v1/x402/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signature: paymentSig,
        payer: fundedPayer.publicKey.toBase58(),
        amount,
        nonce,
      }),
    });
    const replay: any = await rRes.json();
    check("the same payment cannot be spent twice", replay?.valid === false, JSON.stringify(replay).slice(0, 120));

    const claimed = await query(`select 1 from x402_payments where tx_signature = $1`, [paymentSig]);
    check("the claim is recorded in x402_payments", claimed.rows.length === 1);

    console.log(`\n${colors.dim}  explorer: https://explorer.solana.com/tx/${paymentSig}?cluster=devnet${colors.reset}`);
  } finally {
    await query(`delete from x402_quotes where callee_agent_id = $1`, [AGENT_ID]);
    await query(`delete from agents where id = $1`, [AGENT_ID]);
    console.log(`\n${colors.dim}cleaned up (devnet lamports are not recovered — they are worthless)${colors.reset}`);
  }

  console.log(`\n${failed === 0 ? colors.green : colors.red}${passed} passed, ${failed} failed${colors.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run failed:", err?.message ?? err);
  process.exit(1);
});
