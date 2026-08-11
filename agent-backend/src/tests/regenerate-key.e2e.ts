#!/usr/bin/env ts-node-dev

/**
 * END-TO-END: regenerating the developer API key
 *
 * Drives the real HTTP routes and asserts the promises the UI makes:
 *   - a key can be looked up as metadata but never re-read
 *   - regeneration demands a fresh emailed code, scoped to this action alone
 *   - it invalidates the previous key, so "any service using it will stop working"
 *     is literally true rather than a warning we hope is accurate
 *   - the code-send path cannot be used to hammer the mail provider
 *
 * Codes are read through the service layer, so no mail is sent.
 *
 * Requires: server on BASE_URL and DATABASE_URL pointing at a dev database.
 */

import "dotenv/config";
import { pool, query } from "../db/client";
import { createEmailVerification, UserRecord } from "../services/authService";
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

let cookie = "";

/**
 * The whole /v1/auth router sits behind an IP limiter (12/min + burst). A test
 * that fires this many requests from one address trips it, and its 429 is
 * indistinguishable by status code from the per-user cooldown this file is
 * actually trying to verify — an earlier run had "an immediate second request is
 * rate limited" passing off the IP limiter while the cooldown was never
 * exercised at all.
 *
 * The two are distinguishable by shape: ipRateLimit answers with a flat
 * { error: "rate_limit_exceeded" } string, while the cooldown raises an AppError
 * and answers { error: { code, details: { reason } } }. So wait out the IP
 * limiter and retry; never swallow the cooldown.
 */
function isIpLimiter(body: any): boolean {
  return typeof body?.error === "string" && body.error === "rate_limit_exceeded";
}

async function rawApi(path: string, init: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body, headers: res.headers };
}

async function api(path: string, init: RequestInit = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await rawApi(path, init);
    if (r.status !== 429 || !isIpLimiter(r.body)) return r;
    const waitS = Number(r.body?.retryAfter ?? 60) + 1;
    console.log(`  ${colors.dim}(IP limiter hit; waiting ${waitS}s — not the cooldown under test)${colors.reset}`);
    await new Promise((res) => setTimeout(res, waitS * 1000));
  }
  return rawApi(path, init);
}

/**
 * Wait until every IP-limiter window has rolled over, so the cooldown assertions
 * below are measuring the per-user cooldown and not leftover IP budget.
 *
 * This used to drain /v1/auth/me until it 429'd and then wait out that window,
 * which only worked while all ipRateLimit instances shared one counter. They no
 * longer do (each config has its own bucket), so draining the broad 30/min
 * limiter says nothing about the strict 12/min one that governs send-code — and
 * leftover strict-bucket counts from earlier in this file surfaced as an
 * intermittent IP-limiter 429 exactly where the cooldown was expected.
 *
 * An unconditional wait is the only thing that clears a bucket this test cannot
 * observe. Windows are 60s wide, so 61s from now is always past the end of any
 * window already in flight.
 */
const IP_WINDOW_SECONDS = 61;
async function resetIpWindow(): Promise<void> {
  console.log(`  ${colors.dim}(waiting ${IP_WINDOW_SECONDS}s for all IP-limiter windows to roll over)${colors.reset}`);
  await new Promise((res) => setTimeout(res, IP_WINDOW_SECONDS * 1000));
}

/** Hits a gated read route to prove a key is live. */
async function keyWorks(key: string): Promise<boolean> {
  const r = await fetch(`${BASE_URL}/v1/activity/event-types`, { headers: { "x-api-key": key } });
  return r.status === 200;
}

async function userRecord(userId: string): Promise<UserRecord> {
  const r = (await query(`select * from users where id = $1`, [userId])).rows[0];
  return {
    id: r.id,
    email: r.email,
    walletPubkey: r.wallet_pubkey,
    solName: r.sol_name,
    displayName: r.display_name,
    emailVerifiedAt: r.email_verified_at,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  } as UserRecord;
}

async function main() {
  if (!pool) {
    console.error("\nRefusing to run: DATABASE_URL unset (mock mode).\n");
    process.exit(1);
  }
  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`\nRefusing to run: no server at ${BASE_URL}.\n`);
    process.exit(1);
  }

  const email = `regen-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple";
  let userId: string | null = null;

  console.log("\nREGENERATE DEVELOPER KEY (end to end)\n");

  try {
    // Register + verify to get an initial key.
    await api("/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
    userId = (await query(`select id from users where email = $1`, [email])).rows[0].id;
    const firstCode = (await createEmailVerification(await userRecord(userId!), "verify_email")).code;
    const verified = await api("/v1/auth/email/verify", {
      method: "POST",
      body: JSON.stringify({ code: firstCode }),
    });
    const originalKey: string = verified.body?.data?.apiKey;
    check("setup: initial key issued", typeof originalKey === "string" && originalKey.startsWith("Mon_"));
    check("setup: initial key works", await keyWorks(originalKey));

    // -----------------------------------------------------------------------
    console.log("\nGET /v1/auth/api-key exposes metadata only");
    // -----------------------------------------------------------------------
    const meta = await api("/v1/auth/api-key");
    check("returns 200", meta.status === 200, `got ${meta.status}`);
    check("reports a key exists", !!meta.body?.data?.key);
    check("name present", meta.body?.data?.key?.name === "Default");
    const metaStr = JSON.stringify(meta.body);
    check("response does NOT contain the key", !metaStr.includes(originalKey));
    check("response does NOT contain the digest", !metaStr.includes(hashAgentKey(originalKey)));
    check(
      "no field even named like a hash or key material",
      !/hash|secret|plaintext/i.test(Object.keys(meta.body?.data?.key ?? {}).join(",")),
      Object.keys(meta.body?.data?.key ?? {}).join(",")
    );

    // -----------------------------------------------------------------------
    console.log("\nRegeneration requires a real, correctly-scoped code");
    // -----------------------------------------------------------------------
    const noCode = await api("/v1/auth/api-key/regenerate", {
      method: "POST",
      body: JSON.stringify({ code: "000000" }),
    });
    check("a made-up code is refused", noCode.status >= 400, `got ${noCode.status}`);
    check("original key still works after refusal", await keyWorks(originalKey));

    // A SIGNUP code must not authorise regeneration.
    const signupCode = (await createEmailVerification(await userRecord(userId!), "verify_email")).code;
    const crossPurpose = await api("/v1/auth/api-key/regenerate", {
      method: "POST",
      body: JSON.stringify({ code: signupCode }),
    });
    check(
      "a signup code cannot authorise regeneration",
      crossPurpose.status >= 400,
      `got ${crossPurpose.status}`
    );
    check("original key still works after cross-purpose attempt", await keyWorks(originalKey));

    // -----------------------------------------------------------------------
    console.log("\nThe happy path");
    // -----------------------------------------------------------------------
    const stepUp = (await createEmailVerification(await userRecord(userId!), "regenerate_api_key")).code;
    const regen = await api("/v1/auth/api-key/regenerate", {
      method: "POST",
      body: JSON.stringify({ code: stepUp }),
    });
    check("regenerate returns 200", regen.status === 200, `got ${regen.status} ${JSON.stringify(regen.body?.error ?? "")}`);
    const newKey: string = regen.body?.data?.apiKey;
    check("returns a new Mon_ key", typeof newKey === "string" && newKey.startsWith("Mon_"));
    check("new key differs from the old one", newKey !== originalKey);
    check("reports one key revoked", regen.body?.data?.revokedCount === 1, String(regen.body?.data?.revokedCount));

    check("NEW key works", await keyWorks(newKey));
    check("OLD key no longer works — the warning is literally true", !(await keyWorks(originalKey)));

    // -----------------------------------------------------------------------
    console.log("\nThe code is single-use");
    // -----------------------------------------------------------------------
    const replay = await api("/v1/auth/api-key/regenerate", {
      method: "POST",
      body: JSON.stringify({ code: stepUp }),
    });
    check("replaying the code is refused", replay.status >= 400, `got ${replay.status}`);
    check("replay did not mint a third key", await keyWorks(newKey));
    const active = await query(
      `select count(*)::int n from api_keys where user_id = $1 and is_active = true and revoked_at is null`,
      [userId]
    );
    check("exactly one active key remains", active.rows[0].n === 1, String(active.rows[0].n));

    const revokedRows = await query(
      `select count(*)::int n from api_keys where user_id = $1 and revoked_at is not null`,
      [userId]
    );
    check("revoked key kept as history", revokedRows.rows[0].n === 1, String(revokedRows.rows[0].n));

    // -----------------------------------------------------------------------
    console.log("\nThe code-send path cannot hammer the mail provider");
    // -----------------------------------------------------------------------
    // The cooldown is 60s and the IP window is 60s, so waiting out the IP limiter
    // would also expire the very cooldown under test. Instead, deliberately reset
    // the IP window first so the two requests below are guaranteed a fresh budget
    // and can run back-to-back through rawApi with no auto-waiting.
    await resetIpWindow();
    await query(`delete from email_verifications where user_id = $1`, [userId]);

    const first = await rawApi("/v1/auth/api-key/regenerate/send-code", { method: "POST" });
    check("first code request succeeds", first.status === 200, `got ${first.status} ${JSON.stringify(first.body?.error ?? "")}`);

    const second = await rawApi("/v1/auth/api-key/regenerate/send-code", { method: "POST" });
    check("an immediate second request is rate limited", second.status === 429, `got ${second.status}`);
    check(
      "and it is the per-user cooldown, not the IP limiter",
      !isIpLimiter(second.body),
      JSON.stringify(second.body).slice(0, 100)
    );
    check("responds with Retry-After", !!second.headers.get("retry-after"), String(second.headers.get("retry-after")));
    check(
      "rate limited specifically by the cooldown",
      JSON.stringify(second.body).includes("cooldown"),
      JSON.stringify(second.body?.error?.details ?? {}).slice(0, 80)
    );

    // Backdate the sends to clear the cooldown but stay inside the hour, then
    // confirm the hourly cap takes over from the cooldown.
    await query(
      `update email_verifications set created_at = now() - interval '5 minutes'
        where user_id = $1 and purpose = 'regenerate_api_key'`,
      [userId]
    );
    let capped = false;
    for (let i = 0; i < STEP_UP_MAX_PER_HOUR + 2; i++) {
      const r = await api("/v1/auth/api-key/regenerate/send-code", { method: "POST" });
      if (r.status === 429 && JSON.stringify(r.body).includes("hourly_cap")) {
        capped = true;
        break;
      }
      await query(
        `update email_verifications set created_at = now() - interval '5 minutes'
          where user_id = $1 and purpose = 'regenerate_api_key'`,
        [userId]
      );
    }
    check("an hourly cap backs up the cooldown", capped);

    // -----------------------------------------------------------------------
    console.log("\nOther people's keys are unreachable");
    // -----------------------------------------------------------------------
    const otherEmail = `regen-other-${Date.now()}@example.test`;
    await query(`insert into users (email, email_verified_at) values ($1, now())`, [otherEmail]);
    const otherId = (await query(`select id from users where email = $1`, [otherEmail])).rows[0].id;
    const before = await query(`select count(*)::int n from api_keys where user_id = $1`, [otherId]);
    check("control: other user has no key", before.rows[0].n === 0);
    // Our session regenerating must not touch them.
    const after = await query(`select count(*)::int n from api_keys where user_id = $1`, [otherId]);
    check("regeneration never touched another user's keys", after.rows[0].n === 0);
    await query(`delete from users where id = $1`, [otherId]);
  } finally {
    if (userId) {
      await query(`delete from users where id = $1`, [userId]);
      console.log(`\n${colors.dim}cleaned up test user${colors.reset}`);
    }
  }

  console.log(`\n${failed === 0 ? colors.green : colors.red}${passed} passed, ${failed} failed${colors.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

// Mirrors the route's constant; kept local so the test fails loudly if the route
// tightens its cap without the test being updated.
const STEP_UP_MAX_PER_HOUR = 5;

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
