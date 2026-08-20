#!/usr/bin/env ts-node-dev

/**
 * ONLY AGENTS THAT PAID MAY REVIEW
 *
 * A review is worth reading only if writing one costs something. Anybody can
 * type five stars; only a customer can have transferred lamports for the work
 * first. So there are two independent gates on POST /agents/:id/reviews, and
 * both have to hold:
 *
 *   1. you control the agent you are reviewing AS, and
 *   2. that agent has actually paid the agent it is reviewing.
 *
 * Fail either and the review does not exist. The interesting cases are all
 * refusals — a real signed-in owner of a real agent that simply never bought
 * anything, which is what an eligibility check written as an afterthought would
 * wave through.
 *
 * For context on what this replaces: the dashboard's review form invented a
 * reviewer id in the browser (`user-${Date.now()}`) and posted it to a service
 * on localhost:3004 that is not deployed. There was no gate to get wrong.
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
const SUBJECT = `rev-subject-${tag}`;   // the agent being reviewed
const BUYER = `rev-buyer-${tag}`;       // paid via metering
const PAYER = `rev-x402-${tag}`;        // paid on-chain
const FREELOADER = `rev-freeloader-${tag}`; // never paid a thing
const SUBJECT_WALLET = `RevSubjectWallet${tag}`.slice(0, 44);
const PAYER_WALLET = `RevPayerWallet${tag}`.slice(0, 44);

async function makeOwner(label: string) {
  const email = `${label}-${tag}@example.test`;
  const { signSessionToken } = await import("../services/authService");
  const r = (
    await query(`insert into users (email, email_verified_at) values ($1, now()) returning *`, [email])
  ).rows[0];
  return { id: r.id as string, email, cookie: `monocle_session=${signSessionToken({ id: r.id, email: r.email } as any)}` };
}

async function review(cookie: string, subject: string, body: any) {
  const res = await fetch(`${BASE}/v1/agents/${subject}/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, data: json?.data, error: json?.error };
}

const listReviews = async (subject: string) =>
  fetch(`${BASE}/v1/agents/${subject}/reviews`).then((r) => r.json()).then((j: any) => j?.data);

const eligibility = async (subject: string, reviewer: string) =>
  fetch(`${BASE}/v1/agents/${subject}/reviews/eligibility?reviewerAgentId=${reviewer}`)
    .then((r) => r.json())
    .then((j: any) => j?.data);

const countInDb = async () =>
  Number((await query(`select count(*)::int as c from agent_reviews where agent_id = $1`, [SUBJECT])).rows[0].c);

async function main() {
  if (!pool) {
    console.error("\nRefusing to run: DATABASE_URL unset (mock mode).\n");
    process.exit(1);
  }
  if (!(await fetch(`${BASE}/health`).catch(() => null))) {
    console.error(`\nRefusing to run: no server at ${BASE}.\n`);
    process.exit(1);
  }

  console.log("\nONLY AGENTS THAT PAID MAY REVIEW\n");

  const owner = await makeOwner("revowner");
  const other = await makeOwner("revother");

  await query(
    `insert into agents (id, name, public_key, default_rate_per_1k_tokens, balance_lamports, pending_lamports, owner_user_id, owner_email)
     values ($1, 'Subject', $2, 1000, 0, 0, $3, $4)`,
    [SUBJECT, SUBJECT_WALLET, other.id, other.email]
  );
  for (const [id, wallet] of [[BUYER, null], [PAYER, PAYER_WALLET], [FREELOADER, null]] as const) {
    await query(
      `insert into agents (id, name, public_key, default_rate_per_1k_tokens, balance_lamports, pending_lamports, owner_user_id, owner_email)
       values ($1, $1, $2, 1000, 0, 0, $3, $4)`,
      [id, wallet, owner.id, owner.email]
    );
  }

  // BUYER paid through metering; PAYER paid on-chain. FREELOADER did neither.
  await query(
    `insert into tool_usage (caller_agent_id, callee_agent_id, tool_name, tokens_used, rate_per_1k_tokens, cost_lamports)
     values ($1, $2, 'summarize', 3000, 1000, 3000)`,
    [BUYER, SUBJECT]
  );
  await query(
    `insert into x402_payments (tx_signature, nonce, payer_wallet, recipient_wallet, amount_lamports, verified_at)
     values ($1, $2, $3, $4, 5000, now())`,
    [`sig-${tag}`, `nonce-${tag}`, PAYER_WALLET, SUBJECT_WALLET]
  );

  try {
    console.log("Never paid");
    const free = await review(owner.cookie, SUBJECT, { reviewerAgentId: FREELOADER, rating: 5, comment: "Great!" });
    check("a paying-nothing agent cannot review", free.status === 403, `got ${free.status}`);
    check("and is told why", /has not paid/i.test(free.error?.message ?? ""), free.error?.message);
    check("nothing was written", (await countInDb()) === 0);

    const elig = await eligibility(SUBJECT, FREELOADER);
    check("eligibility says no before a form is drawn", elig?.eligible === false && elig?.reason === "no_payment");

    console.log("\nNot your agent to review as");
    // `other` owns SUBJECT, not BUYER — so they may not post as BUYER even
    // though BUYER genuinely paid. Controlling the reviewer is a separate gate
    // from the reviewer having paid.
    const impersonate = await review(other.cookie, SUBJECT, { reviewerAgentId: BUYER, rating: 1, comment: "Terrible" });
    check("you cannot review as an agent you do not control", impersonate.status === 403, `got ${impersonate.status}`);
    check("still nothing written", (await countInDb()) === 0);

    const anon = await fetch(`${BASE}/v1/agents/${SUBJECT}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewerAgentId: BUYER, rating: 5 }),
    });
    check("an anonymous caller cannot review at all", anon.status === 401 || anon.status === 403, `got ${anon.status}`);

    console.log("\nSelf-review");
    const self = await review(other.cookie, SUBJECT, { reviewerAgentId: SUBJECT, rating: 5 });
    check("an agent cannot review itself", self.status === 403, `got ${self.status}`);

    console.log("\nA paying customer");
    const paid = await review(owner.cookie, SUBJECT, { reviewerAgentId: BUYER, rating: 4, comment: "Solid, a bit slow." });
    check("can review", paid.status === 201, `got ${paid.status}`);
    check("the basis is recorded as metered", paid.data?.basis === "metered", paid.data?.basis);
    check("with what they had actually spent", paid.data?.paidLamports === 3000, `${paid.data?.paidLamports}`);
    check("over how many calls", paid.data?.callsAtReview === 1, `${paid.data?.callsAtReview}`);

    console.log("\nAn on-chain payer counts too");
    const x402 = await review(owner.cookie, SUBJECT, { reviewerAgentId: PAYER, rating: 5, comment: "Paid over x402." });
    check("an x402 payment is proof of purchase", x402.status === 201, `got ${x402.status}`);
    check("recorded as such", x402.data?.basis === "x402", x402.data?.basis);
    check("with the amount transferred", x402.data?.paidLamports === 5000, `${x402.data?.paidLamports}`);

    console.log("\nOne review per reviewer");
    const again = await review(owner.cookie, SUBJECT, { reviewerAgentId: BUYER, rating: 2, comment: "Changed my mind." });
    check("a second submission edits the first", again.status === 201, `got ${again.status}`);
    check("rather than adding another", (await countInDb()) === 2, `${await countInDb()} rows`);
    check("the rating is updated", again.data?.rating === 2);
    check("and it is marked edited", again.data?.edited === true);

    console.log("\nRatings");
    for (const bad of [0, 6, 3.5, "five"]) {
      const r = await review(owner.cookie, SUBJECT, { reviewerAgentId: BUYER, rating: bad });
      check(`rating ${JSON.stringify(bad)} is rejected`, r.status === 400, `got ${r.status}`);
    }

    console.log("\nWhat the public sees");
    const list = await listReviews(SUBJECT);
    check("both reviews are listed", list?.reviews?.length === 2, `${list?.reviews?.length}`);
    check("with an average", list?.summary?.average === 3.5, `${list?.summary?.average}`);
    check("and a count, so 5.0 from one reviewer cannot pose as a reputation", list?.summary?.count === 2);
    check(
      "each review carries the spend behind it",
      list?.reviews?.every((r: any) => typeof r.paidLamports === "number" && r.paidLamports > 0)
    );

    const profile = await fetch(`${BASE}/v1/agents/${SUBJECT}/public`)
      .then((r) => r.json())
      .then((j: any) => j?.data);
    check("the public profile shows the summary", profile?.reviews?.count === 2 && profile?.reviews?.average === 3.5,
      JSON.stringify(profile?.reviews));

    console.log("\nDeleting the reviewer removes its reviews");
    await query(`delete from tool_usage where caller_agent_id = $1`, [PAYER]);
    await query(`delete from agents where id = $1`, [PAYER]);
    check("a review with no author left is gone", (await countInDb()) === 1, `${await countInDb()} rows`);
  } finally {
    await query(`delete from agent_reviews where agent_id = $1`, [SUBJECT]);
    await query(`delete from x402_payments where tx_signature = $1`, [`sig-${tag}`]);
    await query(`delete from tool_usage where callee_agent_id = $1`, [SUBJECT]);
    await query(`delete from agents where id in ($1, $2, $3, $4)`, [SUBJECT, BUYER, PAYER, FREELOADER]);
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
