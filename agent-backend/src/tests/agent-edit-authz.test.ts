#!/usr/bin/env ts-node-dev

/**
 * WHO MAY EDIT AN AGENT
 *
 * A regression test for a hole that was live in production.
 *
 * PATCH /v1/agents/:agentId was mounted with apiKeyAuth alone. apiKeyAuth means
 * "presented a valid key", not "is allowed to touch this agent", and the
 * dashboard proxy injects the platform key on any path not named in its
 * sensitive list. PATCH was not on that list. The two together meant an
 * anonymous request — no account, no session, no key — could edit any agent's
 * name, rate, categories, bio and endpoint URL. Reproduced against production:
 * the call answered 404 for an unknown agent id rather than 401, which is proof
 * authentication had already been passed.
 *
 * The endpoint URL is the one that stings: it is where the agent's traffic goes.
 *
 * Nearby, PATCH /:agentId/verification let anyone award the marketplace's
 * "verified" badge, and /:agentId/audits let anyone file a third-party audit.
 * Both are platform trust signals, and its own docstring already said "(admin
 * endpoint)" while the code said otherwise.
 *
 * What is asserted here is mostly refusal, and specifically the refusal of a
 * caller who is signed in and holds a valid API key but does not own the agent.
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
const AGENT = `authz-${tag}`;
const ORIGINAL_ENDPOINT = "https://real-owner.example.com/work";

async function makeUser(label: string, adminRole: string | null = null) {
  const email = `${label}-${tag}@example.test`;
  const { signSessionToken } = await import("../services/authService");
  const r = (
    await query(
      `insert into users (email, email_verified_at, admin_role, is_admin)
       values ($1, now(), $2, $3) returning *`,
      [email, adminRole, adminRole !== null]
    )
  ).rows[0];
  return {
    id: r.id as string,
    email,
    cookie: `monocle_session=${signSessionToken({ id: r.id, email: r.email } as any)}`,
  };
}

async function send(method: string, path: string, body: any, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

const endpointInDb = async () =>
  (await query(`select endpoint_url from agent_endpoints where agent_id = $1`, [AGENT])).rows[0]
    ?.endpoint_url ?? null;

const agentRow = async () =>
  (await query(`select name, default_rate_per_1k_tokens, verified_status from agents where id = $1`, [AGENT]))
    .rows[0];

async function main() {
  if (!pool) {
    console.error("\nRefusing to run: DATABASE_URL unset (mock mode).\n");
    process.exit(1);
  }
  if (!(await fetch(`${BASE}/health`).catch(() => null))) {
    console.error(`\nRefusing to run: no server at ${BASE}.\n`);
    process.exit(1);
  }

  console.log("\nWHO MAY EDIT AN AGENT\n");

  const owner = await makeUser("owner");
  const stranger = await makeUser("stranger");
  const operator = await makeUser("operator", "admin");

  await query(
    `insert into agents (id, name, public_key, default_rate_per_1k_tokens, balance_lamports,
                         pending_lamports, owner_user_id, owner_email, verified_status)
     values ($1, 'Authz Probe', $2, 1000, 0, 0, $3, $4, 'unverified')`,
    [AGENT, `AuthzProbe${tag}`.slice(0, 44), owner.id, owner.email]
  );
  await query(
    `insert into agent_endpoints (agent_id, endpoint_url, is_active, is_healthy)
     values ($1, $2, true, true)`,
    [AGENT, ORIGINAL_ENDPOINT]
  );

  try {
    console.log("A stranger with no credentials at all");
    const anon = await send("PATCH", `/v1/agents/${AGENT}`, {
      name: "Hijacked",
      endpointUrl: "https://attacker.example.com/collect",
      ratePer1kTokens: 999999,
    });
    check("cannot edit the agent", anon.status === 401 || anon.status === 403, `got ${anon.status}`);
    check("the endpoint was not re-pointed", (await endpointInDb()) === ORIGINAL_ENDPOINT);
    check("the name was not changed", (await agentRow()).name === "Authz Probe");

    if (PLATFORM_KEY) {
      console.log("\nThe platform key — what the dashboard proxy injects");
      const withPlatformKey = await send(
        "PATCH",
        `/v1/agents/${AGENT}`,
        { name: "Hijacked", endpointUrl: "https://attacker.example.com/collect" },
        { "x-api-key": PLATFORM_KEY }
      );
      // This is the exact request the proxy used to make on behalf of anyone who
      // asked. A key that names nobody may not act as somebody.
      check(
        "does not authorise editing an agent it does not name",
        withPlatformKey.status === 403,
        `got ${withPlatformKey.status}`
      );
      check("endpoint still unchanged", (await endpointInDb()) === ORIGINAL_ENDPOINT);
    } else {
      console.log(`  ${colors.yellow}SKIP${colors.reset}  platform-key check (AGENTPAY_API_KEY unset)`);
    }

    console.log("\nA signed-in user who owns a different agent");
    const byStranger = await send(
      "PATCH",
      `/v1/agents/${AGENT}`,
      { name: "Hijacked", ratePer1kTokens: 1 },
      { cookie: stranger.cookie }
    );
    check("is refused", byStranger.status === 403, `got ${byStranger.status}`);
    check("rate unchanged", Number((await agentRow()).default_rate_per_1k_tokens) === 1000);

    const strangerPricing = await send(
      "PATCH",
      `/v1/agents/${AGENT}/pricing`,
      { ratePer1kTokens: 5 },
      { cookie: stranger.cookie }
    );
    check("and cannot reprice it either", strangerPricing.status === 403, `got ${strangerPricing.status}`);

    const strangerProfile = await send(
      "PATCH",
      `/v1/agents/${AGENT}/profile`,
      { bio: "owned" },
      { cookie: stranger.cookie }
    );
    check("nor rewrite its profile", strangerProfile.status === 403, `got ${strangerProfile.status}`);

    console.log("\nTrust signals are not self-serve");
    const selfVerify = await send(
      "PATCH",
      `/v1/agents/${AGENT}/verification`,
      { status: "verified" },
      { cookie: owner.cookie }
    );
    check("even the OWNER cannot mark their own agent verified", selfVerify.status === 403, `got ${selfVerify.status}`);
    check("still unverified", (await agentRow()).verified_status === "unverified");

    const strangerAudit = await send(
      "POST",
      `/v1/agents/${AGENT}/audits`,
      { auditType: "security", summary: "trust me" },
      { cookie: stranger.cookie }
    );
    check("a stranger cannot file an audit against it", strangerAudit.status === 403, `got ${strangerAudit.status}`);

    const operatorVerify = await send(
      "PATCH",
      `/v1/agents/${AGENT}/verification`,
      { status: "verified" },
      { cookie: operator.cookie }
    );
    check("an operator can", operatorVerify.status === 200, `got ${operatorVerify.status}`);
    check("and it took effect", (await agentRow()).verified_status === "verified");

    console.log("\nThe actual owner");
    const byOwner = await send(
      "PATCH",
      `/v1/agents/${AGENT}`,
      { name: "Renamed By Owner", endpointUrl: "https://real-owner.example.com/v2" },
      { cookie: owner.cookie }
    );
    check("can still edit their own agent", byOwner.status === 200, `got ${byOwner.status}`);
    check("the name changed", (await agentRow()).name === "Renamed By Owner");
    check("the endpoint changed", (await endpointInDb()) === "https://real-owner.example.com/v2");

    const ownerPricing = await send(
      "PATCH",
      `/v1/agents/${AGENT}/pricing`,
      { ratePer1kTokens: 2500 },
      { cookie: owner.cookie }
    );
    check("and can reprice it", ownerPricing.status === 200, `got ${ownerPricing.status}`);
    check("rate updated", Number((await agentRow()).default_rate_per_1k_tokens) === 2500);

    console.log("\nThe owner's developer key works too — the documented API path");
    const { createDeveloperKey } = await import("../services/securityService");
    const { plainKey } = await createDeveloperKey({ userId: owner.id });
    const byKey = await send(
      "PATCH",
      `/v1/agents/${AGENT}`,
      { name: "Renamed By SDK" },
      { "x-api-key": plainKey }
    );
    check("a Mon_ key belonging to the owner is accepted", byKey.status === 200, `got ${byKey.status}`);
    check("the change landed", (await agentRow()).name === "Renamed By SDK");

    const strangerKey = await createDeveloperKey({ userId: stranger.id });
    const byStrangerKey = await send(
      "PATCH",
      `/v1/agents/${AGENT}`,
      { name: "Hijacked" },
      { "x-api-key": strangerKey.plainKey }
    );
    check(
      "somebody else's Mon_ key is not",
      byStrangerKey.status === 403,
      `got ${byStrangerKey.status}`
    );
    check("name unchanged", (await agentRow()).name === "Renamed By SDK");
  } finally {
    await query(`delete from api_keys where user_id in (select id from users where email like $1)`, [
      `%-${tag}@example.test`,
    ]);
    await query(`delete from agent_endpoints where agent_id = $1`, [AGENT]);
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
