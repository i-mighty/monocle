#!/usr/bin/env ts-node-dev

/**
 * MONEY ROUTES: SESSION-OWNER AUTHORISATION
 *
 * A money route may be authorised two ways and no others:
 *   1. a session whose user owns the named agent, or
 *   2. an agent-scoped key naming that agent.
 *
 * The point of these tests is the boundary, not the happy path. Accepting a
 * session widens how an owner proves themselves; it must not widen WHO may spend
 * an agent's balance. So the cases that matter are the refusals: a different
 * signed-in user, a session with no ownership, and no credential at all.
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
const AGENT = `owncheck-${tag}`;
const OTHER = `owncheck-other-${tag}`;

async function makeVerifiedUser(label: string) {
  const email = `${label}-${tag}@example.test`;
  const { signSessionToken } = await import("../services/authService");
  const res = await query(
    `insert into users (email, email_verified_at) values ($1, now()) returning *`,
    [email]
  );
  const r = res.rows[0];
  const token = signSessionToken({
    id: r.id,
    email: r.email,
    walletPubkey: null,
    solName: null,
    displayName: null,
    emailVerifiedAt: r.email_verified_at,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  } as any);
  return { id: r.id as string, email, cookie: `monocle_session=${token}` };
}

async function meterExecute(headers: Record<string, string>, callerId: string) {
  const res = await fetch(`${BASE}/v1/meter/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ callerId, calleeId: callerId, toolName: "default-tool", tokensUsed: 100 }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
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

  console.log("\nMONEY ROUTES: SESSION-OWNER AUTHORISATION\n");

  const owner = await makeVerifiedUser("owner");
  const stranger = await makeVerifiedUser("stranger");

  // Agent owned by `owner`, funded so the call fails on authorisation rather
  // than on balance — otherwise a refusal proves nothing.
  await query(
    `insert into agents (id, name, default_rate_per_1k_tokens, balance_lamports, pending_lamports, owner_user_id, owner_email)
     values ($1, 'Owned', 1000, 1000000, 0, $2, $3)`,
    [AGENT, owner.id, owner.email]
  );
  // A second agent with NO owner, to prove ownerless does not mean unprotected.
  await query(
    `insert into agents (id, name, default_rate_per_1k_tokens, balance_lamports, pending_lamports)
     values ($1, 'Ownerless', 1000, 1000000, 0)`,
    [OTHER]
  );

  try {
    console.log("Allowed");
    const asOwner = await meterExecute({ cookie: owner.cookie }, AGENT);
    check("owner's session can bill their own agent", asOwner.status === 200, `got ${asOwner.status} ${JSON.stringify(asOwner.body?.error ?? "").slice(0, 90)}`);

    console.log("\nRefused");
    const asStranger = await meterExecute({ cookie: stranger.cookie }, AGENT);
    check(
      "a different signed-in user cannot bill it",
      asStranger.status === 401 || asStranger.status === 403,
      `got ${asStranger.status}`
    );

    const anon = await meterExecute({}, AGENT);
    check("no credential at all is refused", anon.status === 401 || anon.status === 403, `got ${anon.status}`);

    const ownerOnOther = await meterExecute({ cookie: owner.cookie }, OTHER);
    check(
      "owning one agent grants nothing over an ownerless one",
      ownerOnOther.status === 401 || ownerOnOther.status === 403,
      `got ${ownerOnOther.status}`
    );

    const platform = process.env.AGENTPAY_API_KEY;
    if (platform) {
      const withPlatform = await meterExecute({ "x-api-key": platform }, AGENT);
      check(
        "the platform key still cannot bill an agent",
        withPlatform.status === 401 || withPlatform.status === 403,
        `got ${withPlatform.status}`
      );
    }

    const badKey = await meterExecute({ "x-api-key": "mk_not_a_real_key" }, AGENT);
    check("an invalid key is rejected, not ignored", badKey.status === 401, `got ${badKey.status}`);

    // Offering a bad key alongside a valid owner session must not be a way to
    // downgrade into the weaker path — the invalid key is rejected outright.
    const bothBad = await meterExecute({ cookie: owner.cookie, "x-api-key": "mk_not_a_real_key" }, AGENT);
    check(
      "a bad key is not laundered by attaching a valid session",
      bothBad.status === 401,
      `got ${bothBad.status}`
    );

    console.log("\nBalance actually moved for the allowed call");
    const bal = await query(`select balance_lamports from agents where id = $1`, [AGENT]);
    check(
      "owner's call debited the agent",
      Number(bal.rows[0].balance_lamports) < 1000000,
      `balance ${bal.rows[0].balance_lamports}`
    );
    const otherBal = await query(`select balance_lamports from agents where id = $1`, [OTHER]);
    check(
      "the refused calls debited nothing",
      Number(otherBal.rows[0].balance_lamports) === 1000000,
      `balance ${otherBal.rows[0].balance_lamports}`
    );
  } finally {
    await query(`delete from agents where id = any($1)`, [[AGENT, OTHER]]);
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
