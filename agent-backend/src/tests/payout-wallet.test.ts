#!/usr/bin/env ts-node-dev

/**
 * PAYOUT WALLET CHANGES
 *
 * Whoever controls an agent's payout wallet collects its income: settlements land
 * there and x402 callers transfer to it directly. Re-pointing someone else's is
 * the theft PATCH /:agentId was hardened against, so the cases worth testing here
 * are the refusals, not the happy path.
 *
 * The rule under test: an owner may set a first wallet freely, but changing an
 * existing one needs an emailed code, because that redirects money already
 * flowing.
 *
 * Requires: server on BASE_URL and DATABASE_URL pointing at a dev database.
 */

import "dotenv/config";
import { pool, query } from "../db/client";

const BASE = process.env.TEST_BASE_URL || "http://localhost:3001";
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
const AGENT = `payout-${tag}`;
const WALLET_A = "So11111111111111111111111111111111111111112";
const WALLET_B = "SysvarC1ock11111111111111111111111111111111";
const WALLET_C = "SysvarRent111111111111111111111111111111111";

async function makeVerifiedUser(label: string) {
  const email = `${label}-${tag}@example.test`;
  const { signSessionToken } = await import("../services/authService");
  const r = (
    await query(`insert into users (email, email_verified_at) values ($1, now()) returning *`, [email])
  ).rows[0];
  return {
    id: r.id as string,
    email,
    cookie: `monocle_session=${signSessionToken({ id: r.id, email: r.email } as any)}`,
  };
}

async function setWallet(cookie: string, publicKey: string, code?: string) {
  const res = await fetch(`${BASE}/v1/agents/${AGENT}/payout-wallet`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(code ? { publicKey, code } : { publicKey }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

async function walletInDb() {
  const r = await query(`select public_key from agents where id = $1`, [AGENT]);
  return r.rows[0]?.public_key ?? null;
}

async function main() {
  if (!pool) {
    console.error("\nRefusing to run: DATABASE_URL unset (mock mode).\n");
    process.exit(1);
  }
  if (!(await fetch(`${BASE}/health`).catch(() => null))) {
    console.error(`\nRefusing to run: no server at ${BASE}.\n`);
    process.exit(1);
  }

  console.log("\nPAYOUT WALLET CHANGES\n");

  const owner = await makeVerifiedUser("owner");
  const stranger = await makeVerifiedUser("stranger");

  // Owned by `owner`, with no wallet yet — the stranded state this route exists
  // to fix.
  await query(
    `insert into agents (id, name, default_rate_per_1k_tokens, balance_lamports, pending_lamports, owner_user_id, owner_email)
     values ($1, 'Payout Probe', 1000, 0, 5000, $2, $3)`,
    [AGENT, owner.id, owner.email]
  );

  try {
    console.log("Setting a first wallet");
    const anon = await fetch(`${BASE}/v1/agents/${AGENT}/payout-wallet`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: WALLET_A }),
    });
    check("no session is refused", anon.status === 401 || anon.status === 403, `got ${anon.status}`);

    const byStranger = await setWallet(stranger.cookie, WALLET_A);
    check(
      "a different signed-in user cannot set it",
      byStranger.status === 403,
      `got ${byStranger.status}`
    );
    check("and nothing was written", (await walletInDb()) === null);

    const bad = await setWallet(owner.cookie, "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1");
    check("a non-Solana address is rejected", bad.status === 400, `got ${bad.status}`);

    const first = await setWallet(owner.cookie, WALLET_A);
    check("the owner sets a first wallet without a code", first.status === 200, `got ${first.status}`);
    check("it is stored", (await walletInDb()) === WALLET_A);

    console.log("\nChanging an existing wallet");
    const noCode = await setWallet(owner.cookie, WALLET_B);
    check(
      "changing it without a code is refused",
      noCode.status >= 400,
      `got ${noCode.status}`
    );
    check("the wallet is unchanged", (await walletInDb()) === WALLET_A);

    const wrongCode = await setWallet(owner.cookie, WALLET_B, "000000");
    check("a wrong code is refused", wrongCode.status >= 400, `got ${wrongCode.status}`);
    check("still unchanged", (await walletInDb()) === WALLET_A);

    const { createEmailVerification } = await import("../services/authService");
    const challenge = await createEmailVerification(
      { id: owner.id, email: owner.email } as any,
      "change_payout_wallet"
    );
    const withCode = await setWallet(owner.cookie, WALLET_B, challenge.code);
    check("a valid code allows the change", withCode.status === 200, `got ${withCode.status}`);
    check("the new wallet is stored", (await walletInDb()) === WALLET_B);
    check(
      "the response reports what was pending",
      Number(withCode.body?.data?.pendingLamports) === 5000,
      String(withCode.body?.data?.pendingLamports)
    );

    console.log("\nCode hygiene");
    const replay = await setWallet(owner.cookie, WALLET_C, challenge.code);
    check("the same code cannot be reused", replay.status >= 400, `got ${replay.status}`);
    check("wallet unchanged after replay", (await walletInDb()) === WALLET_B);

    const signupCode = await createEmailVerification(
      { id: owner.id, email: owner.email } as any,
      "verify_email"
    );
    const crossPurpose = await setWallet(owner.cookie, WALLET_C, signupCode.code);
    check(
      "a signup code cannot authorise a payout change",
      crossPurpose.status >= 400,
      `got ${crossPurpose.status}`
    );
    check("wallet still unchanged", (await walletInDb()) === WALLET_B);

    console.log("\nCollisions");
    const other = `payout-other-${tag}`;
    await query(
      `insert into agents (id, name, public_key, default_rate_per_1k_tokens, balance_lamports, pending_lamports)
       values ($1, 'Other', $2, 1000, 0, 0)`,
      [other, WALLET_C]
    );
    const taken = await setWallet(owner.cookie, WALLET_C, "123456");
    check("a wallet already used by another agent is refused", taken.status >= 400, `got ${taken.status}`);
    await query(`delete from agents where id = $1`, [other]);
  } finally {
    await query(`delete from agents where id like $1`, [`payout-%${tag}`]);
    await query(`delete from agents where id = $1`, [AGENT]);
    await query(`delete from users where email like $1`, [`%-${tag}@example.test`]);
    console.log(`\n${colors.dim}cleaned up${colors.reset}`);
  }

  console.log(`\n${failed === 0 ? colors.green : colors.red}${passed} passed, ${failed} failed${colors.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
