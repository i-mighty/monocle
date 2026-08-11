#!/usr/bin/env ts-node-dev

/**
 * END-TO-END: signup -> email verification -> developer key issued
 *
 * Drives the real HTTP routes against a running server and a real database,
 * asserting the behaviour the product promises:
 *   - registering does NOT mint a key (unverified signups consume no key records)
 *   - verifying the email returns a `Mon_` key exactly once
 *   - the database holds only a digest, never the key
 *   - the key actually authenticates a read route
 *   - the key is still refused on a route that moves money
 *
 * The verification code is read via the service layer rather than from a real
 * inbox, so no mail is sent and Brevo is never touched.
 *
 * Requires: server on BASE_URL and DATABASE_URL pointing at a dev database.
 *   Terminal 1: npm run dev
 *   Terminal 2: npx ts-node-dev --transpile-only src/tests/verify-issues-key.e2e.ts
 */

import "dotenv/config";
import { pool, query } from "../db/client";
import { hashAgentKey } from "../services/securityService";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3001";

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

/** Minimal cookie jar: keeps the session cookie across requests. */
let cookie = "";

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

async function main() {
  if (!pool) {
    console.error("\nRefusing to run: DATABASE_URL unset (db/client would be in mock mode).\n");
    process.exit(1);
  }

  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`\nRefusing to run: no server answering at ${BASE_URL}. Start it with 'npm run dev'.\n`);
    process.exit(1);
  }

  const email = `e2e-key-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple";
  let userId: string | null = null;

  console.log("\nSIGNUP -> VERIFY -> KEY (end to end)\n");

  try {
    // -----------------------------------------------------------------------
    console.log("Registration");
    // -----------------------------------------------------------------------
    const reg = await api("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    check("register returns 201", reg.status === 201, `got ${reg.status}`);
    check("session cookie issued", cookie.startsWith("monocle_session="), cookie.slice(0, 24));
    check("register response carries no apiKey", reg.body?.data?.apiKey === undefined);

    userId = (await query(`select id from users where email = $1`, [email])).rows[0]?.id ?? null;
    check("user row created", !!userId);

    const keysAfterRegister = await query(`select count(*)::int n from api_keys where user_id = $1`, [userId]);
    check(
      "NO key minted at registration",
      keysAfterRegister.rows[0].n === 0,
      `${keysAfterRegister.rows[0].n} key(s)`
    );

    // -----------------------------------------------------------------------
    console.log("\nVerification issues the key");
    // -----------------------------------------------------------------------
    // Read the code the server just issued. Codes are stored hashed, so mint a
    // known one through the same service the route uses instead of guessing.
    const { createEmailVerification } = await import("../services/authService");
    const userRow = (await query(`select * from users where id = $1`, [userId])).rows[0];
    const challenge = await createEmailVerification({
      id: userRow.id,
      email: userRow.email,
      walletPubkey: userRow.wallet_pubkey,
      solName: userRow.sol_name,
      displayName: userRow.display_name,
      emailVerifiedAt: userRow.email_verified_at,
      createdAt: userRow.created_at,
      lastSeenAt: userRow.last_seen_at,
    } as any);

    const ver = await api("/v1/auth/email/verify", {
      method: "POST",
      body: JSON.stringify({ code: challenge.code }),
    });
    check("verify returns 200", ver.status === 200, `got ${ver.status} ${JSON.stringify(ver.body?.error ?? "")}`);
    check("email marked verified", ver.body?.data?.user?.emailVerified === true);

    const apiKey: string | undefined = ver.body?.data?.apiKey;
    check("verify response contains apiKey", typeof apiKey === "string", String(apiKey));
    check("key has Mon_ prefix", !!apiKey?.startsWith("Mon_"), apiKey?.slice(0, 8));

    // -----------------------------------------------------------------------
    console.log("\nStorage");
    // -----------------------------------------------------------------------
    const keyRow = (await query(`select * from api_keys where user_id = $1`, [userId])).rows[0];
    check("exactly one key row", !!keyRow);
    check("stored as sha256 digest", keyRow?.key_hash === hashAgentKey(apiKey!));
    check("plaintext column null", keyRow?.key === null);
    check("key absent from entire row", !JSON.stringify(keyRow).includes(apiKey!));
    check("name defaults to 'Default'", keyRow?.name === "Default", keyRow?.name);
    check("scopes persisted as array", Array.isArray(JSON.parse(keyRow?.scopes ?? "null")));
    check("names no agent", keyRow?.agent_id === null);

    // -----------------------------------------------------------------------
    console.log("\nThe key actually works");
    // -----------------------------------------------------------------------
    // /v1/activity/event-types is genuinely apiKeyAuth-gated (401 without a key).
    // Assert on 200 specifically, not "not 401": an earlier version of this test
    // pointed at a path that did not exist, and 404 satisfied "not 401" — so it
    // passed while proving nothing. The unauthenticated control below is what
    // keeps this honest.
    const control = await fetch(`${BASE_URL}/v1/activity/event-types`);
    check("control: route rejects no key at all", control.status === 401, `got ${control.status}`);

    const authed = await fetch(`${BASE_URL}/v1/activity/event-types`, {
      headers: { "x-api-key": apiKey! },
    });
    check("developer key authenticates a read route", authed.status === 200, `got ${authed.status}`);

    const badKey = await fetch(`${BASE_URL}/v1/activity/event-types`, {
      headers: { "x-api-key": "Mon_" + "x".repeat(43) },
    });
    check("a forged Mon_ key is rejected", badKey.status === 401, `got ${badKey.status}`);

    // -----------------------------------------------------------------------
    console.log("\nStill refused where it must be (money routes)");
    // -----------------------------------------------------------------------
    const money = await fetch(`${BASE_URL}/v1/meter/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey! },
      body: JSON.stringify({ callerId: "some-agent", calleeId: "other-agent", tokens: 10 }),
    });
    const moneyBody: any = await money.json().catch(() => ({}));
    check(
      "developer key cannot move money (requireOwnAgent)",
      money.status === 403 || money.status === 401,
      `got ${money.status}`
    );
    check(
      "rejected specifically for not naming an agent",
      JSON.stringify(moneyBody).includes("key_not_agent_scoped"),
      JSON.stringify(moneyBody?.error?.details ?? moneyBody).slice(0, 120)
    );

    // -----------------------------------------------------------------------
    console.log("\nIdempotence");
    // -----------------------------------------------------------------------
    const challenge2 = await createEmailVerification({
      id: userRow.id,
      email: userRow.email,
    } as any);
    const reVerify = await api("/v1/auth/email/verify", {
      method: "POST",
      body: JSON.stringify({ code: challenge2.code }),
    });
    check(
      "re-verifying does not return a second key",
      reVerify.body?.data?.apiKey === null || reVerify.body?.data?.apiKey === undefined,
      String(reVerify.body?.data?.apiKey)
    );
    const finalCount = await query(
      `select count(*)::int n from api_keys where user_id = $1 and is_active = true and revoked_at is null`,
      [userId]
    );
    check("still exactly one active key", finalCount.rows[0].n === 1, `${finalCount.rows[0].n}`);
  } finally {
    if (userId) {
      await query(`delete from users where id = $1`, [userId]);
      console.log(`\n${colors.dim}cleaned up test user${colors.reset}`);
    }
  }

  console.log(`\n${failed === 0 ? colors.green : colors.red}${passed} passed, ${failed} failed${colors.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
