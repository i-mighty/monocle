#!/usr/bin/env ts-node-dev

/**
 * WHO MAY SEE EVERYONE ELSE'S DATA
 *
 * /v1/dashboard/* answers platform questions: total revenue, the failure log,
 * what each agent spends and earns, who the biggest earners are. None of it is
 * scoped to the caller. It shipped with no authentication at all — analytics.ts
 * imported apiKeyAuth and applied it to nothing — so every one of those routes
 * was readable by anybody who knew the path. Verified against production before
 * this change: GET /v1/dashboard/platform-revenue answered 200 to a bare curl.
 *
 * The cases that matter are therefore the refusals, and specifically the refusal
 * of a caller who IS authenticated but is not an operator — a signed-in
 * developer with a valid session and a valid API key. That is the one an
 * authentication check alone would wave through.
 *
 * Requires: server on BASE_URL and DATABASE_URL pointing at a dev database.
 */

import "dotenv/config";
import { pool, query } from "../db/client";

const BASE = process.env.TEST_BASE_URL || "http://localhost:3001";
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

/** Every operator-only route, so a new one cannot quietly ship ungated. */
const OPERATOR_ROUTES = [
  "/v1/dashboard/overview",
  "/v1/dashboard/platform-revenue",
  "/v1/dashboard/failures",
  "/v1/dashboard/earnings",
  "/v1/dashboard/earnings/by-agent",
  "/v1/dashboard/receipts",
  "/v1/dashboard/usage",
  "/v1/dashboard/costs",
  "/v1/dashboard/spend",
  "/v1/dashboard/revenue",
  "/v1/dashboard/performance",
  "/v1/dashboard/leaderboard/spenders",
  "/v1/dashboard/leaderboard/earners",
  "/v1/dashboard/leaderboard/active",
  "/v1/chat/analytics/agents",
  "/v1/chat/analytics/classification",
  "/v1/chat/analytics/tasks",
  "/v1/chat/analytics/failures",
];

async function makeUser(label: string, isAdmin: boolean) {
  const email = `${label}-${tag}@example.test`;
  const { signSessionToken } = await import("../services/authService");
  const r = (
    await query(
      `insert into users (email, email_verified_at, is_admin) values ($1, now(), $2) returning *`,
      [email, isAdmin]
    )
  ).rows[0];
  return {
    id: r.id as string,
    email,
    cookie: `monocle_session=${signSessionToken({ id: r.id, email: r.email } as any)}`,
  };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, { headers }).then((r) => r.status);

/**
 * Sweep a list of routes one at a time.
 *
 * Not Promise.all: unauthenticated callers get 30 requests a minute plus a
 * burst of 5, all keyed to one bucket because the server does not trust
 * X-Forwarded-For, so a parallel sweep of every route reports 429 for the tail
 * and looks exactly like a gate that failed. Sequential, then pause between
 * sweeps, and the statuses mean what they say.
 */
async function sweep(paths: string[], headers: Record<string, string> = {}) {
  const out: number[] = [];
  for (const p of paths) out.push(await get(p, headers));
  return out;
}

/** The rate-limit window, waited out so the next sweep starts with a fresh budget. */
async function newRateLimitWindow() {
  console.log(`  ${colors.dim}(waiting out the rate-limit window)${colors.reset}`);
  await new Promise((r) => setTimeout(r, 61_000));
}

function summarise(paths: string[], statuses: number[], expected: number) {
  return paths
    .map((p, i) => `${p} -> ${statuses[i]}`)
    .filter((_, i) => statuses[i] !== expected)
    .join(", ");
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

  console.log("\nWHO MAY SEE EVERYONE ELSE'S DATA\n");

  const operator = await makeUser("operator", true);
  const developer = await makeUser("developer", false);

  try {
    console.log("No credentials");
    const anon = await sweep(OPERATOR_ROUTES);
    check(
      `all ${OPERATOR_ROUTES.length} operator routes refuse an anonymous caller`,
      anon.every((s) => s === 401),
      summarise(OPERATOR_ROUTES, anon, 401) || undefined
    );
    check("none of them leaked a 200", !anon.includes(200));

    await newRateLimitWindow();

    console.log("\nAuthenticated, but not an operator");
    const asDeveloper = await sweep(OPERATOR_ROUTES, { cookie: developer.cookie });
    check(
      "a signed-in developer is refused everywhere",
      asDeveloper.every((s) => s === 403),
      summarise(OPERATOR_ROUTES, asDeveloper, 403) || undefined
    );
    check(
      "the refusal is about permission, not identity — 403, never 401",
      asDeveloper.every((s) => s === 403)
    );

    if (PLATFORM_KEY) {
      const withKey = await get("/v1/dashboard/platform-revenue", { "x-api-key": PLATFORM_KEY });
      check(
        "a valid API key is not enough — a key says who, not what they may see",
        withKey === 401,
        `got ${withKey}`
      );
    } else {
      console.log(`  ${colors.yellow}SKIP${colors.reset}  API-key check (AGENTPAY_API_KEY unset)`);
    }

    const forgedAdminKey = await get("/v1/dashboard/platform-revenue", { "x-admin-key": "not-the-key" });
    check("a guessed admin key is refused", forgedAdminKey === 403, `got ${forgedAdminKey}`);

    await newRateLimitWindow();

    console.log("\nAn operator");
    // A sample rather than the full sweep: one middleware guards them all, and
    // the remaining request budget is better spent on the revocation checks.
    const SAMPLE = OPERATOR_ROUTES.slice(0, 6);
    const asOperator = await sweep(SAMPLE, { cookie: operator.cookie });
    // 5xx would mean the route is broken, not that the gate is wrong; the gate
    // is doing its job as long as nothing is an auth refusal.
    check(
      "gets through the operator routes",
      asOperator.every((s) => s !== 401 && s !== 403),
      SAMPLE.map((p, i) => `${p} -> ${asOperator[i]}`)
        .filter((_, i) => asOperator[i] === 401 || asOperator[i] === 403)
        .join(", ") || undefined
    );
    check(
      "and the platform overview actually answers",
      (await get("/v1/dashboard/overview", { cookie: operator.cookie })) === 200
    );

    console.log("\nThe role is read live, not from the session");
    // The session token is a signed snapshot from before the change. If the role
    // were carried in the token, revocation would not take effect until it
    // expired — which for a 30-day session is not revocation at all.
    await query(`update users set is_admin = false where id = $1`, [operator.id]);
    const afterRevoke = await get("/v1/dashboard/overview", { cookie: operator.cookie });
    check("revoking access takes effect on the next request", afterRevoke === 403, `got ${afterRevoke}`);

    await query(`update users set is_admin = true where id = $1`, [operator.id]);
    const afterRegrant = await get("/v1/dashboard/overview", { cookie: operator.cookie });
    check("and restoring it works the same way", afterRegrant === 200, `got ${afterRegrant}`);

    console.log("\nGranting");
    const grantNoKey = await fetch(`${BASE}/v1/auth/admin/role`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: developer.email, isAdmin: true }),
    });
    check(
      "the grant endpoint cannot be called without the machine key",
      grantNoKey.status === 401 || grantNoKey.status === 503,
      `got ${grantNoKey.status}`
    );

    const grantAsOperator = await fetch(`${BASE}/v1/auth/admin/role`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: operator.cookie },
      body: JSON.stringify({ email: developer.email, isAdmin: true }),
    });
    check(
      "an operator session cannot grant either — that needs the machine key",
      grantAsOperator.status === 401 || grantAsOperator.status === 503,
      `got ${grantAsOperator.status}`
    );

    const stillNotAdmin = await query(`select is_admin from users where id = $1`, [developer.id]);
    check("and the developer was not promoted", stillNotAdmin.rows[0].is_admin === false);

    console.log("\nDefaults");
    const fresh = await query(
      `insert into users (email) values ($1) returning is_admin`,
      [`fresh-${tag}@example.test`]
    );
    check("a new account is not an operator", fresh.rows[0].is_admin === false);
  } finally {
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
