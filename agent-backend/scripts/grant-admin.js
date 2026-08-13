/**
 * Grant or revoke Monocle operator access.
 *
 *   node scripts/grant-admin.js you@example.com          # grant
 *   node scripts/grant-admin.js you@example.com --revoke # revoke
 *   node scripts/grant-admin.js --list                   # who has it
 *
 * Why this exists as a script rather than only as an endpoint: POST
 * /v1/auth/admin/role is gated by ADMIN_API_KEY, which is not set on this
 * deployment. An admin-gated grant endpoint cannot create the first admin
 * either. Something has to reach the database directly to break that circle,
 * and a script anyone with DATABASE_URL can run is the smallest such thing.
 *
 * Reads DATABASE_URL from the environment — export it, do not rely on .env,
 * which this deliberately does not load. Pointing this at the wrong database is
 * the mistake worth making hard, so it prints which host it is about to touch
 * and refuses to guess a default.
 */

const { Client } = require("pg");

async function main() {
  const args = process.argv.slice(2);
  const list = args.includes("--list");
  const revoke = args.includes("--revoke");
  const email = args.find((a) => !a.startsWith("--"));

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Export it and re-run.");
    process.exit(1);
  }
  if (!list && !email) {
    console.error("Usage: node scripts/grant-admin.js <email> [--revoke] | --list");
    process.exit(1);
  }

  // Say where, without printing the password.
  let where = "(unparseable DATABASE_URL)";
  try {
    const u = new URL(url);
    where = `${u.host}${u.pathname}`;
  } catch {
    /* keep the placeholder */
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (list) {
      const r = await client.query(
        "select email, id from users where is_admin = true order by email"
      );
      console.log(`\nOperators on ${where}: ${r.rows.length}`);
      r.rows.forEach((row) => console.log(`  ${row.email ?? "(no email)"}  ${row.id}`));
      console.log("");
      return;
    }

    const r = await client.query(
      "update users set is_admin = $2 where lower(email) = lower($1) returning id, email",
      [email.trim(), !revoke]
    );

    if (r.rows.length === 0) {
      console.error(
        `\nNo account with email ${email} on ${where}.\n` +
          "The account must exist first — sign up in the dashboard, then run this.\n"
      );
      process.exit(1);
    }

    console.log(
      `\n${revoke ? "Revoked" : "Granted"} operator access for ${r.rows[0].email} on ${where}.` +
        `\n  user id: ${r.rows[0].id}\n`
    );
    if (!revoke) {
      console.log("They can now open /admin and /analytics in the dashboard.\n");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // A missing column means the migration has not run on this database.
  if (String(err.message).includes("is_admin")) {
    console.error(
      "\nThis database has no is_admin column — run `npm run db:migrate:deploy` first.\n"
    );
    process.exit(1);
  }
  console.error("Failed:", err.message);
  process.exit(1);
});
