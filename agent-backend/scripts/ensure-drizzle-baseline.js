/**
 * Baseline the pre-Drizzle schema so `drizzle-kit migrate` can run.
 *
 * The production database was built from src/db/schema.sql long before Drizzle
 * migrations existed, so its tables (agents, tools, …) are already present but
 * Drizzle's tracking table has no record of the 0000 baseline. `drizzle-kit
 * migrate` therefore tries to run 0000 — a plain `CREATE TABLE agents (...)` —
 * against a database where `agents` already exists, and fails. That is why the
 * EC2 deploy has failed at the migration step on every run.
 *
 * This marks 0000 as already applied WITHOUT running it, but only when the DB
 * clearly predates Drizzle: `agents` exists AND no migration is recorded yet. On
 * a genuinely fresh database it does nothing, so `drizzle-kit migrate` runs 0000
 * normally. Idempotent and non-destructive: it only ever INSERTs the baseline row
 * when it is absent — it never runs DDL, never drops, never alters data.
 *
 * Run this immediately before `npm run db:migrate`.
 */

const { readFileSync } = require("fs");
const { createHash } = require("crypto");
const path = require("path");
const { Client } = require("pg");

// Must match the journal entry for 0000 in drizzle/meta/_journal.json.
const BASELINE_WHEN = 1782716223987;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[baseline] DATABASE_URL is not set — skipping (migrate will surface the real error).");
    process.exit(1);
  }

  const sql0 = readFileSync(path.join(__dirname, "..", "drizzle", "0000_clammy_bishop.sql"), "utf8");
  const hash0 = createHash("sha256").update(sql0).digest("hex");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("create schema if not exists drizzle");
    await client.query(
      "create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)"
    );

    const agents = await client.query("select to_regclass('public.agents') is not null as exists");
    const migrations = await client.query("select count(*)::int as count from drizzle.__drizzle_migrations");
    const preDrizzle = agents.rows[0].exists === true;
    const recorded = migrations.rows[0].count;

    if (preDrizzle && recorded === 0) {
      await client.query(
        "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
        [hash0, BASELINE_WHEN]
      );
      console.log("[baseline] pre-Drizzle DB detected — recorded 0000 as applied. migrate will apply only newer migrations.");
    } else {
      console.log(`[baseline] no action needed (agents exists=${preDrizzle}, migrations recorded=${recorded}).`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[baseline] failed:", err.message);
  process.exit(1);
});
