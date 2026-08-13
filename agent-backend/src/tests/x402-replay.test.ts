#!/usr/bin/env ts-node-dev

/**
 * X402 REPLAY PROTECTION
 *
 * Exercises the claim in x402_payments that stops one payment buying service
 * twice. It deliberately tests the CLAIM, not verifyPaymentProof end to end:
 * that function also fetches a real transaction from Solana, and a test that
 * needed a genuine on-chain payment could not run here. The on-chain half is
 * unchanged; the replay half is what moved from memory to the database.
 *
 * The properties that matter:
 *   - a signature can be claimed once, and a second attempt loses
 *   - the same signature under a FRESH nonce still loses — the old in-memory
 *     store keyed on nonce alone, so this was the hole
 *   - concurrent submissions of one proof produce exactly one winner
 *   - claims survive a restart, because they are rows rather than a Map
 *
 * Requires: DATABASE_URL pointing at a dev database.
 */

import "dotenv/config";
import { pool, query } from "../db/client";

const colors = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", dim: "\x1b[2m" };
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
const RECIPIENT = "So11111111111111111111111111111111111111112";

/** The exact claim verifyPaymentProof performs. */
async function claim(signature: string, nonce: string, payer = "payer-wallet") {
  const res = await query(
    `insert into x402_payments
       (tx_signature, nonce, payer_wallet, recipient_wallet, amount_lamports, network, verified_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict do nothing
     returning id`,
    [signature, nonce, payer, RECIPIENT, 1000, "solana-devnet"]
  );
  return res.rows.length > 0;
}

async function main() {
  if (!pool) {
    console.error("\nRefusing to run: DATABASE_URL unset (db/client would be in mock mode,\n" +
      "where every insert reports zero rows and every assertion below would 'pass').\n");
    process.exit(1);
  }

  console.log("\nX402 REPLAY PROTECTION\n");

  const sigA = `sig-${tag}-a`;
  const sigB = `sig-${tag}-b`;

  try {
    console.log("A payment can be claimed once");
    check("first claim wins", await claim(sigA, `nonce-${tag}-1`));
    check("identical resubmission loses", !(await claim(sigA, `nonce-${tag}-1`)));

    console.log("\nThe signature is the identity, not the nonce");
    check(
      "same signature under a FRESH nonce still loses",
      !(await claim(sigA, `nonce-${tag}-2`)),
      "this is the hole the in-memory store had"
    );
    check(
      "same nonce under a different signature also loses",
      !(await claim(sigB, `nonce-${tag}-1`))
    );
    check("an unrelated payment is unaffected", await claim(sigB, `nonce-${tag}-3`));

    console.log("\nConcurrency");
    const sigC = `sig-${tag}-c`;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claim(sigC, `nonce-${tag}-c${i}`))
    );
    const winners = results.filter(Boolean).length;
    check("exactly one of 8 concurrent submissions wins", winners === 1, `${winners} winners`);

    console.log("\nDurability");
    const rows = await query(
      `select count(*)::int n from x402_payments where tx_signature = any($1)`,
      [[sigA, sigB, sigC]]
    );
    check(
      "claims are rows, so they survive a restart",
      rows.rows[0].n === 3,
      `${rows.rows[0].n} rows`
    );

    const rec = await query(
      `select payer_wallet, recipient_wallet, amount_lamports, verified_at
         from x402_payments where tx_signature = $1`,
      [sigA]
    );
    check("the claim records who paid whom", rec.rows[0]?.recipient_wallet === RECIPIENT);
    check("and stamps verification time", !!rec.rows[0]?.verified_at);
  } finally {
    await query(`delete from x402_payments where tx_signature like $1`, [`sig-${tag}-%`]);
    console.log(`\n${colors.dim}cleaned up${colors.reset}`);
  }

  console.log(`\n${failed === 0 ? colors.green : colors.red}${passed} passed, ${failed} failed${colors.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
