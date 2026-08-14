#!/usr/bin/env ts-node-dev

/**
 * THE OPERATOR CONSOLE, AND WHO SEES WHAT
 *
 * /v1/admin/* is Monocle's view of every account: the roster, the call log,
 * per-agent earnings, platform revenue, and the ability to hand somebody else
 * the same view. Three levels, so there are three ways to be wrong and only one
 * of them looks like a bug in testing:
 *
 *   under-exposing  a viewer cannot see the roster  -> somebody complains
 *   over-exposing   a viewer CAN see revenue        -> nobody complains
 *
 * The second is what this file is for. Most of these assertions are a caller
 * with real, valid operator access being refused the level above theirs.
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
const AGENT = `console-agent-${tag}`;
const CALLER = `console-caller-${tag}`;

async function makeUser(label: string, role: string | null) {
  const email = `${label}-${tag}@example.test`;
  const { signSessionToken } = await import("../services/authService");
  const r = (
    await query(
      `insert into users (email, email_verified_at, admin_role, is_admin)
       values ($1, now(), $2, $3) returning *`,
      [email, role, role !== null]
    )
  ).rows[0];
  return {
    id: r.id as string,
    email,
    cookie: `monocle_session=${signSessionToken({ id: r.id, email: r.email } as any)}`,
  };
}

async function get(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body: body?.data ?? body };
}

async function put(path: string, cookie: string, payload: any) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body: body?.data ?? body };
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

  console.log("\nTHE OPERATOR CONSOLE, AND WHO SEES WHAT\n");

  const viewer = await makeUser("viewer", "viewer");
  const admin = await makeUser("admin", "admin");
  const owner = await makeUser("owner", "owner");
  const nobody = await makeUser("nobody", null);

  // An agent with real numbers behind it, so "sees the money" is a claim about
  // a value rather than about an empty table.
  await query(
    `insert into agents (id, name, public_key, default_rate_per_1k_tokens, balance_lamports, pending_lamports, owner_email)
     values ($1, 'Console Probe', $2, 1000, 0, 7000, $3)`,
    [AGENT, `ConsoleProbe${tag}`.slice(0, 44), owner.email]
  );
  await query(
    `insert into agents (id, name, default_rate_per_1k_tokens, balance_lamports, pending_lamports)
     values ($1, 'Console Caller', 1000, 0, 0)`,
    [CALLER]
  );
  await query(
    `insert into tool_usage (caller_agent_id, callee_agent_id, tool_name, tokens_used, rate_per_1k_tokens, cost_lamports)
     values ($1, $2, 'summarize', 1500, 1000, 2000)`,
    [CALLER, AGENT]
  );

  try {
    console.log("Not an operator");
    for (const p of ["/v1/admin/agents", "/v1/admin/calls", "/v1/admin/money", "/v1/admin/operators"]) {
      const anon = await get(p);
      const user = await get(p, nobody.cookie);
      check(`${p} refuses anonymous`, anon.status === 401, `got ${anon.status}`);
      check(`${p} refuses a signed-in non-operator`, user.status === 403, `got ${user.status}`);
    }

    console.log("\nViewer — operations, not money");
    const vAgents = await get("/v1/admin/agents", viewer.cookie);
    check("sees the agent roster", vAgents.status === 200, `got ${vAgents.status}`);
    const probe = (vAgents.body?.agents ?? []).find((a: any) => a.agentId === AGENT);
    check("the roster includes every agent, not just owned ones", !!probe);
    check("with operational detail", probe?.callsServed === 1, `callsServed=${probe?.callsServed}`);
    check(
      "but NO earnings",
      probe !== undefined &&
        probe.earnedLamports === undefined &&
        probe.pendingLamports === undefined &&
        probe.directLamports === undefined,
      JSON.stringify({ earned: probe?.earnedLamports, pending: probe?.pendingLamports })
    );
    check("and is told money is hidden rather than absent", vAgents.body?.moneyVisible === false);

    const vCalls = await get("/v1/admin/calls", viewer.cookie);
    check("sees the call log", vCalls.status === 200 && Array.isArray(vCalls.body?.calls));

    const vMoney = await get("/v1/admin/money", viewer.cookie);
    check("is refused platform revenue", vMoney.status === 403, `got ${vMoney.status}`);
    const vOps = await get("/v1/admin/operators", viewer.cookie);
    check("is refused the operator list", vOps.status === 403, `got ${vOps.status}`);
    const vGrant = await put("/v1/admin/operators", viewer.cookie, { email: nobody.email, role: "owner" });
    check("cannot promote anyone", vGrant.status === 403, `got ${vGrant.status}`);

    console.log("\nAdmin — money, but not the keys to the kingdom");
    const aAgents = await get("/v1/admin/agents", admin.cookie);
    const aProbe = (aAgents.body?.agents ?? []).find((a: any) => a.agentId === AGENT);
    check("sees what an agent earned", aProbe?.earnedLamports === 2000, `${aProbe?.earnedLamports}`);
    check("and what it is owed", aProbe?.pendingLamports === 7000, `${aProbe?.pendingLamports}`);

    const aMoney = await get("/v1/admin/money", admin.cookie);
    check("sees platform revenue", aMoney.status === 200, `got ${aMoney.status}`);
    check(
      "which separates what we earn from what merely flows through",
      typeof aMoney.body?.platformRevenueLamports === "number" &&
        aMoney.body?.direct?.feeLamports === 0,
      JSON.stringify(aMoney.body?.direct)
    );
    check(
      "metered volume counts the call",
      Number(aMoney.body?.metered?.volumeLamports) >= 2000,
      `${aMoney.body?.metered?.volumeLamports}`
    );

    const aOps = await get("/v1/admin/operators", admin.cookie);
    check("can see who the operators are", aOps.status === 200, `got ${aOps.status}`);
    const aGrant = await put("/v1/admin/operators", admin.cookie, { email: nobody.email, role: "admin" });
    check("but cannot grant access", aGrant.status === 403, `got ${aGrant.status}`);
    const unchanged = await query(`select admin_role from users where id = $1`, [nobody.id]);
    check("and nothing was written", unchanged.rows[0].admin_role === null);

    console.log("\nOwner — hands out access");
    const grant = await put("/v1/admin/operators", owner.cookie, { email: nobody.email, role: "viewer" });
    check("promotes an account", grant.status === 200, `got ${grant.status}`);
    check("reporting what changed", grant.body?.previousRole === null && grant.body?.role === "viewer");

    const promoted = await get("/v1/admin/agents", nobody.cookie);
    check("the promotion takes effect immediately, on the old session", promoted.status === 200, `got ${promoted.status}`);

    const revoke = await put("/v1/admin/operators", owner.cookie, { email: nobody.email, role: null });
    check("and revokes it", revoke.status === 200, `got ${revoke.status}`);
    const afterRevoke = await get("/v1/admin/agents", nobody.cookie);
    check("which also takes effect at once", afterRevoke.status === 403, `got ${afterRevoke.status}`);

    const badRole = await put("/v1/admin/operators", owner.cookie, { email: nobody.email, role: "superuser" });
    check("an invented level is rejected", badRole.status === 400, `got ${badRole.status}`);

    const noSuchUser = await put("/v1/admin/operators", owner.cookie, {
      email: "ghost@example.test",
      role: "viewer",
    });
    check("granting to a non-existent account is refused", noSuchUser.status >= 400, `got ${noSuchUser.status}`);

    console.log("\nThe platform cannot be left without an owner");
    // This owner is the only one in the table for this run, but other rows may
    // exist from real use — so assert against the actual count.
    const owners = Number(
      (await query(`select count(*)::int as c from users where admin_role = 'owner'`)).rows[0].c
    );
    const selfDemote = await put("/v1/admin/operators", owner.cookie, {
      email: owner.email,
      role: "admin",
    });
    if (owners <= 1) {
      check("the last owner cannot demote themselves", selfDemote.status === 400, `got ${selfDemote.status}`);
      const stillOwner = await query(`select admin_role from users where id = $1`, [owner.id]);
      check("and remains an owner", stillOwner.rows[0].admin_role === "owner");
    } else {
      check(
        "demotion is allowed while another owner exists",
        selfDemote.status === 200,
        `got ${selfDemote.status} with ${owners} owners`
      );
      await query(`update users set admin_role = 'owner', is_admin = true where id = $1`, [owner.id]);
    }

    console.log("\nThe boolean and the role do not drift");
    const mirror = await query(
      `select admin_role, is_admin from users where id in ($1, $2, $3)`,
      [viewer.id, admin.id, owner.id]
    );
    check(
      "every operator row has is_admin true alongside its role",
      mirror.rows.every((r: any) => r.is_admin === true && r.admin_role !== null)
    );
  } finally {
    await query(`delete from tool_usage where callee_agent_id = $1 or caller_agent_id = $1`, [AGENT]);
    await query(`delete from agents where id in ($1, $2)`, [AGENT, CALLER]);
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
