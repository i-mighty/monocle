#!/usr/bin/env ts-node-dev

/**
 * CREDENTIAL SEPARATION
 *
 * Monocle has three kinds of credential and they must never mix:
 *
 *   1. `Mon_...`            developer-facing; the only one a user ever sees
 *   2. ADMIN_API_KEY        operator-only; never in any user-facing response
 *   3. SMTP_USER/SMTP_PASS  server-only; never touches a client response
 *
 * Plus the platform key (AGENTPAY_API_KEY) and the signing/encryption secrets,
 * which are likewise server-only.
 *
 * This drives real endpoints — including error paths, which are where secrets
 * usually escape — and asserts that no secret's VALUE appears anywhere in the
 * response body or headers. Checking values rather than names is the point: a
 * response is only safe if the actual bytes are absent.
 *
 * Requires: server on BASE_URL, DATABASE_URL, and a populated .env.
 */

import "dotenv/config";
import { pool, query } from "../db/client";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3001";
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

/** Secrets whose literal value must never appear in a response. */
function collectSecrets(): { name: string; value: string }[] {
  const names = [
    "ADMIN_API_KEY",
    "ADMIN_SESSION_SECRET",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_HOST",
    "AGENTPAY_API_KEY",
    "JWT_SECRET",
    "LOG_ENCRYPTION_KEY",
    "RESEND_API_KEY",
    "BREVO_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "GOOGLE_API_KEY",
    "SOLANA_PAYER_SECRET",
  ];
  const out: { name: string; value: string }[] = [];
  for (const n of names) {
    const v = process.env[n];
    // Very short values produce false positives against arbitrary JSON.
    if (v && v.length >= 8) out.push({ name: n, value: v });
  }
  // The database password, extracted from the URL.
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const m = dbUrl.match(/^[^:]+:\/\/[^:]+:([^@]+)@/);
    if (m && m[1].length >= 8) out.push({ name: "DATABASE_URL password", value: m[1] });
  }
  return out;
}

const secrets = collectSecrets();

/** Assert no secret value appears in this response's body or headers. */
function assertClean(label: string, status: number, bodyText: string, headers: Headers) {
  const headerText = [...headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  const haystack = `${bodyText}\n${headerText}`;
  const leaked = secrets.filter((s) => haystack.includes(s.value));
  check(
    `${label} [${status}] leaks no secret`,
    leaked.length === 0,
    leaked.length ? `LEAKED: ${leaked.map((l) => l.name).join(", ")}` : undefined
  );
}

let cookie = "";
async function probe(label: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const text = await res.text();
  assertClean(label, res.status, text, res.headers);
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, text, json };
}

async function main() {
  if (!pool) {
    console.error("\nRefusing to run: DATABASE_URL unset (mock mode).\n");
    process.exit(1);
  }
  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`\nRefusing to run: no server at ${BASE_URL}.\n`);
    process.exit(1);
  }

  console.log("\nCREDENTIAL SEPARATION\n");
  console.log(`${colors.dim}watching for ${secrets.length} secret values: ${secrets.map((s) => s.name).join(", ")}${colors.reset}\n`);

  if (secrets.length === 0) {
    console.error("Refusing to run: no secrets found in env, so every assertion would pass vacuously.\n");
    process.exit(1);
  }

  const email = `credsep-${Date.now()}@example.test`;
  let userId: string | null = null;

  try {
    // -----------------------------------------------------------------------
    console.log("Unauthenticated surfaces");
    // -----------------------------------------------------------------------
    await probe("GET /health", "/health");
    await probe("GET /", "/");
    await probe("GET /v1/auth/me (no session)", "/v1/auth/me");
    await probe("GET /v1/agents (no key)", "/v1/agents");
    await probe("GET /v1/activity/event-types (no key)", "/v1/activity/event-types");
    await probe("GET /v1/dashboard/overview", "/v1/dashboard/overview");

    // -----------------------------------------------------------------------
    console.log("\nError paths (where secrets usually escape)");
    // -----------------------------------------------------------------------
    await probe("GET /v1/agents (bad key)", "/v1/agents", { headers: { "x-api-key": "totally-wrong" } });
    await probe("GET /nonexistent-route", "/nonexistent-route");
    await probe("POST /v1/auth/login (malformed)", "/v1/auth/login", {
      method: "POST",
      body: "{not json",
    });
    await probe("POST /v1/auth/login (bad creds)", "/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password" }),
    });

    // -----------------------------------------------------------------------
    console.log("\nAdmin-gated routes must not echo the admin key");
    // -----------------------------------------------------------------------
    await probe("POST /v1/auth/admin/verify-email (no admin key)", "/v1/auth/admin/verify-email", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    await probe("POST /v1/auth/admin/verify-email (wrong admin key)", "/v1/auth/admin/verify-email", {
      method: "POST",
      headers: { "x-admin-key": "wrong-admin-key" },
      body: JSON.stringify({ email }),
    });

    // -----------------------------------------------------------------------
    console.log("\nThe full developer-key lifecycle");
    // -----------------------------------------------------------------------
    await probe("POST /v1/auth/register", "/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    });
    userId = (await query(`select id from users where email = $1`, [email])).rows[0]?.id ?? null;

    const { createEmailVerification } = await import("../services/authService");
    const u = (await query(`select * from users where id = $1`, [userId])).rows[0];
    const code = (await createEmailVerification({ id: u.id, email: u.email } as any, "verify_email")).code;

    const verified = await probe("POST /v1/auth/email/verify", "/v1/auth/email/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    const devKey: string | undefined = verified.json?.data?.apiKey;
    check("developer key issued", typeof devKey === "string" && devKey.startsWith("Mon_"));

    await probe("GET /v1/auth/api-key", "/v1/auth/api-key");
    await probe("GET /v1/agents (with developer key)", "/v1/agents", {
      headers: { "x-api-key": devKey! },
    });

    const stepUp = (await createEmailVerification({ id: u.id, email: u.email } as any, "regenerate_api_key")).code;
    const regen = await probe("POST /v1/auth/api-key/regenerate", "/v1/auth/api-key/regenerate", {
      method: "POST",
      body: JSON.stringify({ code: stepUp }),
    });

    // -----------------------------------------------------------------------
    console.log("\nThe developer key is the ONLY credential a user receives");
    // -----------------------------------------------------------------------
    const newKey: string | undefined = regen.json?.data?.apiKey;
    check("regenerate returned a Mon_ key", typeof newKey === "string" && newKey.startsWith("Mon_"));
    check(
      "no response ever returned the platform key",
      !!process.env.AGENTPAY_API_KEY && newKey !== process.env.AGENTPAY_API_KEY
    );
    check(
      "the developer key is not the admin key",
      !process.env.ADMIN_API_KEY || newKey !== process.env.ADMIN_API_KEY
    );

    // -----------------------------------------------------------------------
    console.log("\nStored key material is one-way");
    // -----------------------------------------------------------------------
    const rows = await query(`select * from api_keys where user_id = $1`, [userId]);
    const allRows = JSON.stringify(rows.rows);
    check("no stored row contains any issued key", !allRows.includes(newKey!) && !allRows.includes(devKey!));
    check(
      "no stored row contains a server secret",
      !secrets.some((s) => allRows.includes(s.value))
    );
  } finally {
    if (userId) await query(`delete from users where id = $1`, [userId]);
    console.log(`\n${colors.dim}cleaned up${colors.reset}`);
  }

  console.log(`\n${failed === 0 ? colors.green : colors.red}${passed} passed, ${failed} failed${colors.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
