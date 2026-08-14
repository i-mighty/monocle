/**
 * Grant or revoke Monocle operator access.
 *
 *   node scripts/grant-admin.js you@example.com                 # grant (owner)
 *   node scripts/grant-admin.js you@example.com --role=admin    # grant a level
 *   node scripts/grant-admin.js you@example.com --revoke        # revoke
 *   node scripts/grant-admin.js --list                          # who has what
 *
 * Levels: viewer (agents and calls), admin (+ money), owner (+ manage
 * operators). Grants default to owner because this is the bootstrap path — the
 * first operator has to be able to create the others.
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
  const ROLES = ["viewer", "admin", "owner"];
  const list = args.includes("--list");
  const revoke = args.includes("--revoke");
  const email = args.find((a) => !a.startsWith("--"));
  const roleArg = args.find((a) => a.startsWith("--role="));
  const role = revoke ? null : roleArg ? roleArg.slice("--role=".length) : "owner";

  if (role !== null && !ROLES.includes(role)) {
    console.error(`Unknown role "${role}". Use one of: ${ROLES.join(", ")}.`);
    process.exit(1);
  }

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
        `select email, id, admin_role from users where admin_role is not null
          order by case admin_role when 'owner' then 0 when 'admin' then 1 else 2 end, email`
      );
      console.log(`\nOperators on ${where}: ${r.rows.length}`);
      r.rows.forEach((row) =>
        console.log(`  ${(row.admin_role ?? "?").padEnd(6)}  ${row.email ?? "(no email)"}  ${row.id}`)
      );
      console.log("");
      return;
    }

    // Refuse to strip the last owner: operator management would become
    // unreachable from the dashboard, recoverable only by running this script
    // again — which assumes whoever needs it has database access.
    if (role !== "owner") {
      const target = await client.query(
        "select admin_role from users where lower(email) = lower($1)",
        [email.trim()]
      );
      if (target.rows[0]?.admin_role === "owner") {
        const owners = await client.query(
          "select count(*)::int as c from users where admin_role = 'owner'"
        );
        if (owners.rows[0].c <= 1) {
          console.error(
            `
${email} is the only owner. Promote somebody else first:
` +
              `  node scripts/grant-admin.js someone@else.com --role=owner
`
          );
          process.exit(1);
        }
      }
    }

    const r = await client.query(
      `update users set admin_role = $2, is_admin = $3
        where lower(email) = lower($1) returning id, email`,
      [email.trim(), role, role !== null]
    );

    if (r.rows.length === 0) {
      console.error(
        `\nNo account with email ${email} on ${where}.\n` +
          "The account must exist first — sign up in the dashboard, then run this.\n"
      );
      process.exit(1);
    }

    console.log(
      `\n${revoke ? "Revoked operator access for" : `Set ${role} on`} ${r.rows[0].email} on ${where}.` +
        `\n  user id: ${r.rows[0].id}\n`
    );
    if (!revoke) {
      // Say what this level actually opens. "You can open /analytics" is wrong
      // for a viewer, and a wrong instruction is worse than none.
      const opens = {
        viewer: "the Agents and Calls tabs of /operator",
        admin: "all of /operator including Money, plus /analytics",
        owner: "all of /operator including Operators, plus /analytics",
      };
      console.log(`They can now see ${opens[role]}.\n`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // A missing column means the migration has not run on this database.
  if (String(err.message).includes("is_admin") || String(err.message).includes("admin_role")) {
    console.error(
      "\nThis database has no admin_role column — run `npm run db:migrate:deploy` first.\n"
    );
    process.exit(1);
  }
  console.error("Failed:", err.message);
  process.exit(1);
});
