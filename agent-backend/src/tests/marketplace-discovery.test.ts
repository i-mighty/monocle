#!/usr/bin/env ts-node-dev

/**
 * WHAT THE MARKETPLACE SHOWS, AND WHAT IT DOES NOT
 *
 * The marketplace is a trust surface: being listed is Monocle saying this agent
 * has been checked. So listing is verified-only, and not a filter the caller can
 * switch off — an opt-in checkbox meant the default view mixed checked and
 * unchecked agents with a small badge as the only difference, which puts the
 * burden of noticing on the buyer.
 *
 * Alongside it, /:agentId/public is the evidence a buyer reads before paying:
 * capabilities, outcomes reported by callers, who has paid this agent, audits
 * somebody else filed. It is unauthenticated, because discovery has to work
 * before you have an account — which makes what it must NOT contain just as
 * important as what it does. The owner's email and the agent's balance are
 * asserted absent.
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
const VERIFIED = `mkt-verified-${tag}`;
const UNVERIFIED = `mkt-unverified-${tag}`;
const CLIENT = `mkt-client-${tag}`;
const OWNER_EMAIL = `mkt-owner-${tag}@example.test`;

async function listing(qs = "") {
  const res = await fetch(`${BASE}/v1/agents/marketplace?limit=100${qs}`);
  const body: any = await res.json();
  return { status: res.status, agents: body?.data?.agents ?? [] };
}

async function publicProfile(agentId: string) {
  const res = await fetch(`${BASE}/v1/agents/${agentId}/public`);
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, raw: JSON.stringify(body ?? {}), data: body?.data };
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

  console.log("\nWHAT THE MARKETPLACE SHOWS, AND WHAT IT DOES NOT\n");

  // Two agents identical but for verification, so the listing difference can
  // only be the thing under test.
  for (const [id, status] of [[VERIFIED, "verified"], [UNVERIFIED, "unverified"]] as const) {
    await query(
      `insert into agents (id, name, bio, public_key, default_rate_per_1k_tokens, balance_lamports,
                           pending_lamports, categories, verified_status, owner_email, reputation_score)
       values ($1, $2, 'Does useful things.', $3, 1000, 4242, 777, '["research"]', $4, $5, 640)`,
      [id, `Probe ${status}`, `MktKey${status}${tag}`.slice(0, 44), status, OWNER_EMAIL]
    );
    await query(
      `insert into agent_endpoints (agent_id, endpoint_url, is_active, is_healthy)
       values ($1, $2, true, true)`,
      [id, `https://probe-${status}.example.com/work`]
    );
  }
  await query(
    `insert into agents (id, name, default_rate_per_1k_tokens, balance_lamports, pending_lamports)
     values ($1, 'Client', 1000, 0, 0)`,
    [CLIENT]
  );

  // Evidence for the public profile: a capability, and two calls of which one
  // was reported successful.
  await query(
    `insert into agent_capabilities (agent_id, capability, proficiency_level, is_verified)
     values ($1, 'summarisation', 'expert', 'true')`,
    [VERIFIED]
  );
  await query(
    `insert into tool_usage (caller_agent_id, callee_agent_id, tool_name, tokens_used,
                             rate_per_1k_tokens, cost_lamports, success, latency_ms)
     values ($1, $2, 'summarize', 1000, 1000, 1000, true, 250)`,
    [CLIENT, VERIFIED]
  );
  await query(
    `insert into tool_usage (caller_agent_id, callee_agent_id, tool_name, tokens_used,
                             rate_per_1k_tokens, cost_lamports, success, latency_ms)
     values ($1, $2, 'summarize', 1000, 1000, 1000, false, 900)`,
    [CLIENT, VERIFIED]
  );

  try {
    console.log("Listing");
    const all = await listing();
    const ids = all.agents.map((a: any) => a.id);
    check("a verified agent is listed", ids.includes(VERIFIED));
    check("an unverified agent is not", !ids.includes(UNVERIFIED));
    check("everything returned is verified", all.agents.every((a: any) => a.verified === true));

    const forced = await listing("&verified=false");
    check(
      "verified=false cannot switch the filter off",
      !forced.agents.map((a: any) => a.id).includes(UNVERIFIED)
    );

    console.log("\nUnverified agents are hidden, not disabled");
    const hidden = await publicProfile(UNVERIFIED);
    check("their public page still resolves", hidden.status === 200, `got ${hidden.status}`);
    check("and says plainly that it is not listed", hidden.data?.availability?.listedInMarketplace === false);
    check("while reporting a healthy endpoint honestly", hidden.data?.availability?.isHealthy === true);

    console.log("\nThe public profile carries evidence, not claims");
    const p = await publicProfile(VERIFIED);
    check("it is readable with no credentials", p.status === 200, `got ${p.status}`);
    check(
      "capabilities, with proficiency",
      p.data?.capabilities?.[0]?.capability === "summarisation" &&
        p.data?.capabilities?.[0]?.proficiency === "expert"
    );
    check("calls served", p.data?.track?.callsServed === 2, `${p.data?.track?.callsServed}`);
    check(
      "success rate over REPORTED calls only",
      p.data?.track?.successRate === 0.5 && p.data?.track?.reportedCalls === 2,
      `rate=${p.data?.track?.successRate} reported=${p.data?.track?.reportedCalls}`
    );
    check("who it has worked for", p.data?.workedFor?.[0]?.agentId === CLIENT);
    check("how many times", p.data?.workedFor?.[0]?.calls === 2);
    check("its rating", p.data?.reputationScore === 640, `${p.data?.reputationScore}`);
    check("and the wallet a caller must pay", typeof p.data?.payoutWallet === "string");

    console.log("\nWhat it must never carry");
    check("no owner email", !p.raw.includes(OWNER_EMAIL), "owner email present in response");
    check(
      "no balance",
      !("balanceLamports" in (p.data ?? {})) && !p.raw.includes("4242"),
      "balance present in response"
    );
    check(
      "no pending earnings",
      !("pendingLamports" in (p.data ?? {})) && !p.raw.includes("777"),
      "pending present in response"
    );

    console.log("\nA missing agent");
    const missing = await publicProfile(`nope-${tag}`);
    check("answers 404, not an empty profile", missing.status === 404, `got ${missing.status}`);
  } finally {
    await query(`delete from tool_usage where callee_agent_id = $1 or caller_agent_id = $2`, [VERIFIED, CLIENT]);
    await query(`delete from agent_capabilities where agent_id = $1`, [VERIFIED]);
    await query(`delete from agent_endpoints where agent_id in ($1, $2)`, [VERIFIED, UNVERIFIED]);
    await query(`delete from agents where id in ($1, $2, $3)`, [VERIFIED, UNVERIFIED, CLIENT]);
    console.log(`\n${colors.dim}cleaned up${colors.reset}`);
  }

  console.log(`\n${failed === 0 ? colors.green : colors.red}${passed} passed, ${failed} failed${colors.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
