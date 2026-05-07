# C1 — Removing the API key from the public bundle

**Problem.** `NEXT_PUBLIC_MONOCLE_API_KEY` is currently inlined into the
dashboard's client JS bundle at build time. Every visitor can read it
from `view-source:`. Whoever has it can call any `apiKeyAuth`-protected
endpoint as Monocle.

This doc lays out the three architectures that fix it, with tradeoffs,
so you can pick deliberately rather than reactively.

---

## Option 1 — Server-side proxy in Next.js (smallest change)

**How it works.** Move every authenticated call from the browser to a
Next.js API route under `pages/api/proxy/[...path].ts`. The API route
runs on the dashboard's server (not in the browser), holds the API key
in a server-only env var, and forwards the request to the backend.

```
[Browser] → /api/proxy/agents/register → [Next.js server]
                                              │ injects x-api-key
                                              ▼
                                         [Backend API]
```

**What changes.**
- Add a single catch-all proxy route in `agent-dashboard/pages/api/proxy/[...path].ts`.
- Rename `NEXT_PUBLIC_MONOCLE_API_KEY` → `MONOCLE_API_KEY` (drop the public prefix).
- Keep `NEXT_PUBLIC_BACKEND_URL` (URL is fine to be public).
- In every component that called `${BACKEND}/v1/...`, change the URL to
  `/api/proxy/v1/...` — same path shape, just routed through Next.

**Pros.**
- ~30 lines of code, ~2 hours of work.
- Zero backend changes.
- API key never leaves the server.
- Works with the existing `apiKeyAuth` model.

**Cons.**
- The proxy is a single trust boundary — anyone who can hit your
  dashboard can hit any backend endpoint via the proxy. You still need
  per-user auth in front (sessions, login) before the proxy.
- One shared key for all users. No per-user rate limiting or audit attribution.
- Extra hop adds latency (~5-20ms typical, your Railway services are
  in the same region so it's negligible).

**When this is enough.**
- You're shipping a v1 demo and only your team / pilot users will see
  the dashboard.
- You'll add real user auth in a follow-up sprint.

---

## Option 2 — Per-user JWT sessions (right answer for production)

**How it works.** Users log in (email/password, magic link, OAuth, or
SIWS — Sign In With Solana). The backend issues a short-lived JWT
scoped to that user. The dashboard stores the JWT in an HttpOnly cookie
and sends it on every request. The backend verifies the JWT and
attributes the action to that user.

```
[Browser] ──login──> [Backend]
              <──JWT (HttpOnly cookie)──┘
[Browser] ──Authorization: Bearer <jwt>──> [Backend]
                                              │ verify, attribute to user
                                              ▼
                                         (handler with req.user.id)
```

**What changes.**
- Add `/v1/auth/login`, `/v1/auth/logout`, `/v1/auth/me` endpoints.
- Add a `users` table (you have `admin_users` — extend or add a parallel
  `users` table for end users).
- Add JWT signing/verification middleware (`jsonwebtoken` package). The
  `JWT_SECRET` env var is already set up.
- Replace `apiKeyAuth` on user-facing routes with the new JWT auth.
- `apiKeyAuth` stays for *machine-to-machine* — agents using the SDK
  with their own scoped keys.
- Dashboard gets a login page, logout button, session UI.

**Pros.**
- Real auth. Per-user attribution, scoped permissions, revocable sessions.
- API keys become a separate concept used only by SDK consumers (agent
  builders), where they belong.
- Audit trail per user, not "platform did this."
- Industry standard — every investor / customer / auditor recognizes
  this model.

**Cons.**
- ~3-5 days of work. Touches backend, DB schema, dashboard UX.
- You have to actually build login UI and email/OAuth wiring.
- More moving parts to test.

**When this is the right call.**
- Anyone outside your team will use the dashboard.
- You're talking to investors who'll ask about security.
- Before mainnet.

---

## Option 3 — SIWS (Sign-In With Solana) — wallet-based auth (purist option)

**How it works.** Same as Option 2, but instead of email/password, users
sign a challenge with their Solana wallet (Phantom, Solflare). The
backend verifies the signature and issues a JWT bound to that wallet.

```
[Browser] ──GET /auth/challenge──> [Backend]
              <──nonce──┘
[Wallet] ──signs nonce
[Browser] ──POST /auth/verify {pubkey, signature}──> [Backend]
                                                           │ verify ed25519
                                                           ▼
              <──JWT (HttpOnly cookie)──────────┘
```

**Pros.**
- On-brand for Monocle — your product *is* on-chain identity.
- No password storage, no email infra, no OAuth provider dependency.
- Wallet is the user's identity. SNS lookup gives display names for free.

**Cons.**
- ~5-7 days. Adds wallet adapter UX to the dashboard.
- Excludes anyone who doesn't have a Solana wallet — bad for
  agent-builder developers who just want to log in and read docs.
- Probably not the right move for *every* page (e.g. marketing pages,
  docs, public marketplace).

**When this is the right call.**
- The dashboard is for users who *operate* agents (and therefore own a
  wallet anyway).
- You want a strong "we drink our own champagne" story.

---

## My recommendation

**Stage it.**

1. **This week:** Do Option 1 (proxy route). Stops the bleeding. Removes
   the key from the public bundle. Buys time.

2. **Before mainnet (next 2-3 weeks):** Add Option 2 *or* Option 3 —
   real per-user auth. If your dashboard primarily serves agent
   *operators* with wallets, do SIWS (Option 3). If it's a mix of
   developers and operators, do Option 2 with email + optionally SIWS
   as a second login method.

The proxy from Option 1 isn't wasted work — when you add JWT auth, the
proxy becomes the place where you swap browser-cookie sessions for
backend-side keys. It stays in the architecture.

---

## What we did NOT do today and why

We didn't ship Option 1 right now because:
- It changes the runtime auth path of every dashboard call. That's
  high-blast-radius for a same-day push.
- We just stabilized the deploy. Adding a proxy now means another debug
  cycle if anything misroutes.
- You should make this decision deliberately, not at the end of a long
  session.

The four other fixes (C2, H1, H2, H3, H4) are mechanical and
contained — those went in. C1 is architectural and waits for your call.
