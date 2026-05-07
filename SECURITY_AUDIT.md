# Monocle — Security Audit

**Date:** 2026-05-07
**Scope:** Backend API, Dashboard, SDK, deployment artifacts
**Method:** Static review of source, dependency audit, config review

---

## Executive Summary

Out of ~12 distinct findings, **3 are critical**, **4 high**, **3 medium**, and **2 low**.
The most urgent issue is that the **dashboard ships an authoritative backend API key inside its public JS bundle** — anyone viewing the page source can extract it and impersonate the platform. Everything else is fixable in <1 day; the API-key-in-bundle issue requires a small architectural change.

---

## CRITICAL (fix before mainnet, ideally today)

### C1 — Backend API key baked into client bundle

**Where:** [agent-dashboard/Dockerfile:9](agent-dashboard/Dockerfile#L9), [agent-dashboard/components/chat/X402Badge.tsx:69](agent-dashboard/components/chat/X402Badge.tsx#L69), [agent-dashboard/hooks/useOrchestration.ts:17](agent-dashboard/hooks/useOrchestration.ts#L17), [agent-dashboard/components/chat/ChatPage.tsx:22](agent-dashboard/components/chat/ChatPage.tsx#L22), [agent-dashboard/lib/admin-api.ts:18](agent-dashboard/lib/admin-api.ts#L18)

`NEXT_PUBLIC_MONOCLE_API_KEY` and `NEXT_PUBLIC_ADMIN_API_KEY` are `NEXT_PUBLIC_*` Next.js vars. Next.js inlines those into the client JS at build time — they're literally a string in `_next/static/chunks/*.js`, served to every visitor.

In our deploy we set `NEXT_PUBLIC_MONOCLE_API_KEY` to the same value as the backend's `AGENTPAY_API_KEY`. **Any visitor can `view-source:` your dashboard, grep the JS for `mnk_`, and have full authenticated access to every protected backend endpoint** — register agents, modify policies, drain test balances, etc.

**Impact:** Total auth bypass on every endpoint protected by `apiKeyAuth`. Catastrophic on mainnet.

**Fix:**
- Stop using `NEXT_PUBLIC_*` for secrets. Move authenticated calls to a Next.js API route (`pages/api/*`) that runs server-side, holds the key in non-public env, and proxies to the backend.
- Or implement per-user JWT/session auth on the backend: the dashboard authenticates a *user*, then calls the backend with a short-lived token instead of a shared key.
- Rotate `AGENTPAY_API_KEY` immediately (the current one — `mnk_c77f9dac7ded84747977214044db7ed27678c6ad589e9ae6` — is now compromised).

### C2 — Non-constant-time API key comparison

**Where:** [agent-backend/src/middleware/apiKeyAuth.ts:16](agent-backend/src/middleware/apiKeyAuth.ts#L16)

```ts
if (provided !== expected) { ... }
```

JavaScript's `!==` short-circuits on the first differing byte. An attacker can measure response timing to extract the key one byte at a time. The hardened version ([apiKeyAuthHardened.ts](agent-backend/src/middleware/apiKeyAuthHardened.ts)) uses `crypto.timingSafeEqual` correctly, but the basic one is still imported and used somewhere — every route that uses it inherits the timing leak.

**Fix:** Replace `provided !== expected` with `crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))`, gated on equal lengths. Or delete `apiKeyAuth.ts` entirely and have all routes import the hardened version.

### C3 — Postgres credential leaked during deploy

**Where:** Conversation log (during deploy) — `TCmtgRhTIOvviXJwoZyVfzKptdmetOjD@switchyard.proxy.rlwy.net:18839`

The Postgres `DATABASE_PUBLIC_URL` was printed to chat to seed schema. It's a public-network endpoint that accepts SSL connections from anywhere on the internet.

**Impact:** Anyone with the password can connect over the public proxy and read/write the entire database.

**Fix:**
1. **Rotate now.** Railway → Postgres service → Variables → regenerate `POSTGRES_PASSWORD`. Other services that reference `${{Postgres.DATABASE_URL}}` auto-update.
2. **Disable the public proxy** if you don't need external access. Settings → Networking on the Postgres service → remove the public TCP proxy.
3. **Audit DB for write activity** since the leak: `SELECT * FROM pg_stat_activity WHERE state IS NOT NULL`.

---

## HIGH

### H1 — `.env` files tracked in git

**Where:** [agent-dashboard/.env](agent-dashboard/.env), [agent-sdk/.env](agent-sdk/.env)

Both files are in `.gitignore` but were committed *before* the gitignore rule, so git keeps tracking them. Currently they only contain a localhost URL and a fake `test_key_12345`, but the moment a developer drops a real key into either file, **it'll be silently committed and pushed**.

**Fix:**
```bash
git rm --cached agent-dashboard/.env agent-sdk/.env
git commit -m "chore: untrack .env files (already in .gitignore)"
git push
```

### H2 — CORS is fully open

**Where:** [agent-backend/src/app.ts:43](agent-backend/src/app.ts#L43) — `app.use(cors());`

Default `cors()` allows any origin with credentials. Any malicious site can make requests from a victim's browser and read responses. With shared API keys (C1) this is academic, but once you fix C1, CORS becomes the next exposure.

**Fix:**
```ts
app.use(cors({
  origin: [
    "https://diligent-education-production-aede.up.railway.app",
    "https://yourdomain.com",
  ],
  credentials: true,
}));
```

### H3 — No security headers

**Where:** Backend has no `helmet` middleware or equivalent — no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy. Dashboard has no Content-Security-Policy meta tag.

**Impact:** Clickjacking, MIME-sniffing, downgraded HTTPS, leaky referrers.

**Fix:**
```bash
npm i helmet --prefix agent-backend
```
```ts
import helmet from "helmet";
app.use(helmet());
```
For Next.js, add `headers()` in `next.config.js` with HSTS, frame-deny, CSP.

### H4 — 15 npm vulnerabilities (10 high, 5 moderate)

**Where:** `agent-backend/node_modules` per `npm audit`. Notable: `picomatch` ReDoS, `qs` DoS, `uuid` bounds check.

**Fix:** `npm audit fix` (safe — non-breaking by default). Run again on `agent-dashboard` and `agent-sdk`. Add `npm audit --audit-level=high` to CI to catch regressions.

---

## MEDIUM

### M1 — Internal error messages leaked to clients

**Where:** [agent-backend/src/routes/chat.ts:609,625,641,656,675](agent-backend/src/routes/chat.ts), [meter.ts:217](agent-backend/src/routes/meter.ts#L217), [pricing.ts:520,563,588,619](agent-backend/src/routes/pricing.ts)

```ts
res.status(500).json({ success: false, error: error.message });
```

We saw this in action — the marketplace error returned `relation "request_logs" does not exist` straight to the browser, exposing the internal SQL schema. Useful for debugging, hostile in prod.

**Fix:** Use the existing `errorHandler` from [errors/index.ts](agent-backend/src/errors). Throw `AppError` with stable codes; let the central handler return generic messages in prod, full details in dev. Stop calling `res.status(500).json({ error: error.message })` directly in route handlers.

### M2 — Database SSL accepts self-signed certs

**Where:** Multiple uses of `ssl: { rejectUnauthorized: false }` (used during this audit's seeding script and in some service code paths).

**Impact:** Vulnerable to MITM if an attacker can intercept the connection. Lower risk on Railway's internal network, real risk if anyone connects via the public proxy.

**Fix:** Set `rejectUnauthorized: true` and pin Railway's CA cert if needed. Or use a managed connection pooler.

### M3 — Schema starts with destructive `DROP TABLE`

**Where:** [agent-backend/src/db/schema.sql:1-10](agent-backend/src/db/schema.sql#L1-L10)

```sql
drop table if exists platform_revenue cascade;
drop table if exists settlements cascade;
...
```

If anyone runs the schema against production by mistake (e.g. via a CI step or an admin tool), it nukes those tables. We've already seen confusion in this session about which schema was applied.

**Fix:** Move drops to a separate `schema-reset.sql`. Production schema should be additive only, with proper migrations (drizzle-kit is already a dep — wire it up).

---

## LOW

### L1 — Compiled `dist/` directories tracked in git

**Where:** `agent-backend/dist/`, `agent-sdk/dist/` — tracked despite `dist/` being in `.gitignore`.

**Impact:** Compiled output drifts from source. If a developer's local build accidentally inlines a secret (it shouldn't, but), it'd be committed silently. Also bloats every clone and PR.

**Fix:** `git rm -r --cached agent-backend/dist agent-sdk/dist` then commit.

### L2 — Unrelated `setup.sh` in repo root

**Where:** [setup.sh](setup.sh)

Foreign install script for an unrelated product (`superstack` Solana skill installer). Not committed yet, but sitting in the repo working tree. Risk: someone runs it not knowing what it is.

**Fix:** Delete it (`rm setup.sh`). If you want a Monocle install script, write a real one.

---

## What we DID well (for credit)

- ✅ `enforceProductionRequirements` validates required env vars at boot and throws fatally.
- ✅ Webhook service mentions HMAC signature verification (verify it's actually wired up).
- ✅ Admin auth uses `crypto.timingSafeEqual` correctly.
- ✅ Password hashing uses `pbkdf2` with 100k iterations (acceptable; bcrypt/argon2 would be slightly better).
- ✅ Log encryption uses `scrypt` for key derivation in [securityService.ts](agent-backend/src/services/securityService.ts).
- ✅ Rate limiting middleware exists (`ipRateLimit`, `slowDown`, `rateLimit` per-key).
- ✅ Request ID middleware for tracing.
- ✅ `request_logs` table hashes user IDs (PII consideration).
- ✅ x402 client gracefully no-ops when private key absent.
- ✅ `demoOnly` middleware blocks test endpoints in production (`/agents/fund` etc.).

---

## Recommended remediation order

| Day | Task |
|---|---|
| **0 (now)** | Rotate Postgres password (C3). Disable public TCP proxy on Postgres. Rotate `AGENTPAY_API_KEY`. |
| **1** | Fix C1 (server-side proxy or JWT) — biggest architectural change. Fix C2 (single import). |
| **2** | Fix H1, H2, H3, H4. |
| **3** | Fix M1, M2, M3. |
| **Backlog** | L1, L2. Add `npm audit --audit-level=high` to CI. Add a security headers test. Consider a third-party audit before mainnet. |

---

## Out of scope (worth a follow-up)

- Smart-contract / on-chain security (Ika dWallet usage, x402 facilitator trust, SNS ownership claims) — needs an on-chain auditor.
- Penetration testing of the live deploy — automated scans only here.
- Supply-chain review (provenance of `@ika.xyz/sdk`, `@x402/*`, etc.).
- Threat model document — should be written separately by the team.
