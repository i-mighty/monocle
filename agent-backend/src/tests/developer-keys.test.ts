#!/usr/bin/env ts-node-dev

/**
 * DEVELOPER API KEY TESTS (`Mon_...`)
 *
 * Covers the storage and validation layer:
 * - key shape and randomness
 * - hash-only storage (no plaintext, no reversible form, anywhere in the row)
 * - validation resolves the owning user
 * - a developer key names NO agent, so requireOwnAgent still refuses it on money
 * - revoke-then-mint (the regenerate path) invalidates the old key
 *
 * Every test runs against a real database and cleans up after itself.
 *
 * Requires: DATABASE_URL pointing at a dev database.
 * Run with: npx ts-node-dev --transpile-only src/tests/developer-keys.test.ts
 */

// Must precede the db/client import: the pool is built from DATABASE_URL at
// module load, and without this the client silently falls back to mock mode.
import "dotenv/config";

import { pool, query } from "../db/client";
import {
  generateDeveloperKey,
  createDeveloperKey,
  revokeDeveloperKeysForUser,
  getDeveloperKeyMetadata,
  validateApiKey,
  hashAgentKey,
  DEVELOPER_KEY_PREFIX,
  DEFAULT_DEVELOPER_SCOPES,
} from "../services/securityService";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ${colors.green}PASS${colors.reset}  ${name}`);
  } else {
    failed++;
    console.log(`  ${colors.red}FAIL${colors.reset}  ${name}${detail ? ` ${colors.dim}- ${detail}${colors.reset}` : ""}`);
  }
}

/** Disposable user; the FK cascade removes its keys when we delete it. */
async function createTestUser(tag: string): Promise<string> {
  const email = `devkey-test-${tag}-${Date.now()}@example.test`;
  const res = await query(`insert into users (email) values ($1) returning id`, [email]);
  return res.rows[0].id;
}

async function deleteTestUser(userId: string) {
  await query(`delete from users where id = $1`, [userId]);
}

/**
 * Refuse to run against the in-memory mock.
 *
 * db/client falls back to a mock when DATABASE_URL is unset, and its query()
 * returns { rows: [], rowCount: 0 } for everything. Half the assertions below —
 * "tampered key rejected", "revoked key no longer validates" — check that a
 * lookup finds nothing, so they would all pass against the mock while proving
 * nothing whatsoever. A green run has to mean a real database answered.
 */
async function assertRealDatabase() {
  if (!pool) {
    console.error(
      "\nRefusing to run: DATABASE_URL is not set, so db/client is in mock mode.\n" +
        "Every 'rejected' assertion would pass against a mock that returns no rows.\n"
    );
    process.exit(1);
  }
  const probe = await query("select 1 as ok");
  if (probe.rows[0]?.ok !== 1) {
    console.error("\nRefusing to run: connected client did not answer a trivial query.\n");
    process.exit(1);
  }
}

async function main() {
  console.log("\nDEVELOPER API KEY TESTS\n");
  await assertRealDatabase();
  const createdUsers: string[] = [];

  try {
    // -----------------------------------------------------------------------
    console.log("Key format");
    // -----------------------------------------------------------------------
    const k1 = generateDeveloperKey();
    const k2 = generateDeveloperKey();
    check("starts with Mon_", k1.startsWith("Mon_"), k1.slice(0, 8));
    check("prefix constant matches spec", DEVELOPER_KEY_PREFIX === "Mon_", DEVELOPER_KEY_PREFIX);
    check("two keys differ (not deterministic)", k1 !== k2);
    const secret = k1.slice(DEVELOPER_KEY_PREFIX.length);
    check("secret is base64url only", /^[A-Za-z0-9_-]+$/.test(secret), secret.slice(0, 12) + "...");
    check(
      "secret carries 32 bytes of entropy",
      Buffer.from(secret, "base64url").length === 32,
      `${Buffer.from(secret, "base64url").length} bytes`
    );

    // -----------------------------------------------------------------------
    console.log("\nStorage is hash-only");
    // -----------------------------------------------------------------------
    const userA = await createTestUser("a");
    createdUsers.push(userA);
    const issued = await createDeveloperKey({ userId: userA });
    check("mint returns a Mon_ key", issued.plainKey.startsWith("Mon_"));
    check("default name is 'Default'", issued.name === "Default", issued.name);
    check("scopes persisted", Array.isArray(issued.scopes) && issued.scopes.length > 0);

    const row = (await query(`select * from api_keys where id = $1`, [issued.id])).rows[0];
    check("row stores the sha256 digest", row.key_hash === hashAgentKey(issued.plainKey));
    check("digest is not the key itself", row.key_hash !== issued.plainKey);
    check("plaintext column is null", row.key === null, String(row.key));
    check("row is bound to the user", row.user_id === userA);
    check("row names no agent", row.agent_id === null);

    // The real guarantee: the key must not appear ANYWHERE in the stored row,
    // in any column, in any encoding — not just in the column we expect.
    const serialized = JSON.stringify(row);
    check("key absent from entire row", !serialized.includes(issued.plainKey));
    check("key secret absent from entire row", !serialized.includes(secretOf(issued.plainKey)));

    // -----------------------------------------------------------------------
    console.log("\nValidation");
    // -----------------------------------------------------------------------
    const good = await validateApiKey(issued.plainKey);
    check("valid key validates", good.valid === true, good.error);
    check("resolves to the owning user", good.keyRecord?.userId === userA);
    check(
      "agentId is null — money routes must still refuse it",
      good.keyRecord?.agentId === null,
      String(good.keyRecord?.agentId)
    );
    check("carries default scopes", good.keyRecord?.scopes?.includes("read:agents") === true);
    check(
      "does not carry write:payments",
      good.keyRecord?.scopes?.includes("write:payments") === false
    );

    const tampered = await validateApiKey(issued.plainKey.slice(0, -1) + "X");
    check("tampered key rejected", tampered.valid === false, tampered.error);

    const unknown = await validateApiKey(generateDeveloperKey());
    check("unminted key rejected", unknown.valid === false, unknown.error);

    // -----------------------------------------------------------------------
    console.log("\nMetadata endpoint surface");
    // -----------------------------------------------------------------------
    const meta = await getDeveloperKeyMetadata(userA);
    check("metadata found", meta !== null);
    check("metadata has no key material", !JSON.stringify(meta).includes(issued.plainKey));
    check(
      "metadata exposes no hash",
      !Object.keys(meta ?? {}).some((k) => k.toLowerCase().includes("hash")),
      Object.keys(meta ?? {}).join(",")
    );

    // -----------------------------------------------------------------------
    console.log("\nRegenerate (revoke + mint)");
    // -----------------------------------------------------------------------
    const revoked = await revokeDeveloperKeysForUser(userA);
    check("revoked exactly one key", revoked === 1, String(revoked));

    const afterRevoke = await validateApiKey(issued.plainKey);
    check("revoked key no longer validates", afterRevoke.valid === false, afterRevoke.error);

    const reissued = await createDeveloperKey({ userId: userA });
    check("new key issued after revoke", reissued.plainKey.startsWith("Mon_"));
    check("new key differs from old", reissued.plainKey !== issued.plainKey);

    const newValid = await validateApiKey(reissued.plainKey);
    check("new key validates", newValid.valid === true, newValid.error);

    const oldStillDead = await validateApiKey(issued.plainKey);
    check("old key stays dead after reissue", oldStillDead.valid === false);

    check(
      "metadata now points at the new key",
      (await getDeveloperKeyMetadata(userA))?.id === reissued.id
    );

    // Revoked row is kept as history rather than deleted.
    const history = await query(
      `select count(*)::int n from api_keys where user_id = $1 and revoked_at is not null`,
      [userA]
    );
    check("revoked key retained as history", history.rows[0].n === 1, `${history.rows[0].n} row(s)`);

    // -----------------------------------------------------------------------
    console.log("\nIsolation between users");
    // -----------------------------------------------------------------------
    const userB = await createTestUser("b");
    createdUsers.push(userB);
    const keyB = await createDeveloperKey({ userId: userB });
    const resB = await validateApiKey(keyB.plainKey);
    check("user B's key resolves to user B", resB.keyRecord?.userId === userB);
    check("user B's key is not user A's", resB.keyRecord?.userId !== userA);
    check(
      "user A's metadata unaffected by user B",
      (await getDeveloperKeyMetadata(userA))?.id === reissued.id
    );
  } finally {
    for (const id of createdUsers) await deleteTestUser(id);
    console.log(`\n${colors.dim}cleaned up ${createdUsers.length} test user(s)${colors.reset}`);
  }

  console.log(
    `\n${failed === 0 ? colors.green : colors.red}${passed} passed, ${failed} failed${colors.reset}\n`
  );
  process.exit(failed === 0 ? 0 : 1);
}

function secretOf(key: string): string {
  return key.slice(DEVELOPER_KEY_PREFIX.length);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
