#!/usr/bin/env ts-node-dev

/**
 * VERIFICATION CODE PURPOSE SCOPING
 *
 * Codes guard two different things: confirming an email address at signup, and
 * the step-up challenge in front of API key regeneration. They live in one table,
 * so the only thing stopping a code issued for the first from satisfying the
 * second is the `purpose` filter.
 *
 * Before scoping, `confirmEmailVerification` selected the newest unconsumed code
 * for a user regardless of purpose, and `createEmailVerification` burned all of
 * them. Every assertion below would have failed.
 *
 * Requires: DATABASE_URL pointing at a dev database.
 * Run with: npx ts-node-dev --transpile-only src/tests/verification-purpose.test.ts
 */

import "dotenv/config";
import { pool, query } from "../db/client";
import {
  createEmailVerification,
  confirmEmailVerification,
  consumeStepUpCode,
  UserRecord,
} from "../services/authService";

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

async function makeUser(tag: string): Promise<UserRecord> {
  const email = `purpose-${tag}-${Date.now()}@example.test`;
  const res = await query(
    `insert into users (email, email_verified_at) values ($1, now()) returning *`,
    [email]
  );
  const r = res.rows[0];
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
    console.error("\nRefusing to run: DATABASE_URL unset (db/client would be in mock mode).\n");
    process.exit(1);
  }

  console.log("\nVERIFICATION CODE PURPOSE SCOPING\n");
  const users: string[] = [];

  try {
    // -----------------------------------------------------------------------
    console.log("A signup code cannot authorise a key regeneration");
    // -----------------------------------------------------------------------
    const u1 = await makeUser("a");
    users.push(u1.id);
    const signupCode = (await createEmailVerification(u1, "verify_email")).code;

    const misuse = await consumeStepUpCode(u1.id, signupCode, "regenerate_api_key");
    check("verify_email code rejected as step-up", misuse.ok === false, JSON.stringify(misuse));
    check(
      "rejected as 'no_code', not merely a mismatch",
      misuse.ok === false && misuse.reason === "no_code",
      misuse.ok === false ? misuse.reason : "ok"
    );

    // and it still works for what it was issued for
    const proper = await confirmEmailVerification(u1.id, signupCode);
    check("same code still valid for its own purpose", proper.ok === true);

    // -----------------------------------------------------------------------
    console.log("\nA step-up code cannot verify an email address");
    // -----------------------------------------------------------------------
    const u2 = await makeUser("b");
    users.push(u2.id);
    await query(`update users set email_verified_at = null where id = $1`, [u2.id]);
    const stepUpCode = (await createEmailVerification(u2, "regenerate_api_key")).code;

    const misuse2 = await confirmEmailVerification(u2.id, stepUpCode);
    check("regenerate code rejected by confirmEmailVerification", misuse2.ok === false);
    const stillUnverified = await query(`select email_verified_at from users where id = $1`, [u2.id]);
    check(
      "email NOT marked verified by the rejected attempt",
      stillUnverified.rows[0].email_verified_at === null
    );

    // -----------------------------------------------------------------------
    console.log("\nStep-up does not grant KYC state");
    // -----------------------------------------------------------------------
    const consumed = await consumeStepUpCode(u2.id, stepUpCode, "regenerate_api_key");
    check("step-up code redeems for its own purpose", consumed.ok === true, JSON.stringify(consumed));
    const afterStepUp = await query(`select email_verified_at from users where id = $1`, [u2.id]);
    check(
      "consuming a step-up code leaves email_verified_at untouched",
      afterStepUp.rows[0].email_verified_at === null,
      String(afterStepUp.rows[0].email_verified_at)
    );

    // -----------------------------------------------------------------------
    console.log("\nIssuing one purpose does not burn the other");
    // -----------------------------------------------------------------------
    const u3 = await makeUser("c");
    users.push(u3.id);
    const pendingSignup = (await createEmailVerification(u3, "verify_email")).code;
    // A regeneration request arrives while the user is mid-signup.
    await createEmailVerification(u3, "regenerate_api_key");

    const signupSurvives = await confirmEmailVerification(u3.id, pendingSignup);
    check("pending signup code survives a step-up issuance", signupSurvives.ok === true, JSON.stringify(signupSurvives));

    const u4 = await makeUser("d");
    users.push(u4.id);
    const pendingStepUp = (await createEmailVerification(u4, "regenerate_api_key")).code;
    await createEmailVerification(u4, "verify_email");
    const stepUpSurvives = await consumeStepUpCode(u4.id, pendingStepUp, "regenerate_api_key");
    check("pending step-up code survives a signup issuance", stepUpSurvives.ok === true, JSON.stringify(stepUpSurvives));

    // -----------------------------------------------------------------------
    console.log("\nWithin a purpose, only the newest code works");
    // -----------------------------------------------------------------------
    const u5 = await makeUser("e");
    users.push(u5.id);
    const older = (await createEmailVerification(u5, "regenerate_api_key")).code;
    const newer = (await createEmailVerification(u5, "regenerate_api_key")).code;
    const oldRejected = await consumeStepUpCode(u5.id, older, "regenerate_api_key");
    check("superseded code rejected", oldRejected.ok === false, JSON.stringify(oldRejected));
    const newAccepted = await consumeStepUpCode(u5.id, newer, "regenerate_api_key");
    check("newest code accepted", newAccepted.ok === true, JSON.stringify(newAccepted));

    // -----------------------------------------------------------------------
    console.log("\nSingle use");
    // -----------------------------------------------------------------------
    const replay = await consumeStepUpCode(u5.id, newer, "regenerate_api_key");
    check("a consumed code cannot be replayed", replay.ok === false, JSON.stringify(replay));

    // -----------------------------------------------------------------------
    console.log("\nBrute force is bounded");
    // -----------------------------------------------------------------------
    const u6 = await makeUser("f");
    users.push(u6.id);
    const real = (await createEmailVerification(u6, "regenerate_api_key")).code;
    const wrong = real === "000000" ? "111111" : "000000";
    let sawLockout = false;
    for (let i = 0; i < 12; i++) {
      const r = await consumeStepUpCode(u6.id, wrong, "regenerate_api_key");
      if (r.ok === false && r.reason === "too_many_attempts") {
        sawLockout = true;
        break;
      }
    }
    check("guessing locks out after the attempt ceiling", sawLockout);
    const afterLockout = await consumeStepUpCode(u6.id, real, "regenerate_api_key");
    check(
      "the correct code is refused once locked out",
      afterLockout.ok === false,
      JSON.stringify(afterLockout)
    );

    // -----------------------------------------------------------------------
    console.log("\nStored form");
    // -----------------------------------------------------------------------
    const rows = await query(
      `select purpose, code_hash from email_verifications where user_id = $1`,
      [u6.id]
    );
    check("purpose persisted on the row", rows.rows[0]?.purpose === "regenerate_api_key", rows.rows[0]?.purpose);
    check("code stored hashed, not plaintext", rows.rows.every((r: any) => r.code_hash !== real));
  } finally {
    for (const id of users) await query(`delete from users where id = $1`, [id]);
    console.log(`\n${colors.dim}cleaned up ${users.length} test user(s)${colors.reset}`);
  }

  console.log(`\n${failed === 0 ? colors.green : colors.red}${passed} passed, ${failed} failed${colors.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
