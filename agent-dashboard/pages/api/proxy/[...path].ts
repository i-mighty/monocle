import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Server-side proxy to the Monocle backend.
 *
 * Injects x-api-key from a server-only env var so the key never ships to
 * the browser. Streaming responses (SSE for chat) are forwarded chunk-by-chunk
 * using the Web Streams API (compatible with Node.js 18+ and Cloudflare Workers).
 *
 * SECURITY — the key is NOT injected on endpoints that move money.
 *
 * This proxy is a public, unauthenticated route on the internet, and the key it
 * injects is the platform key: the backend's apiKeyAuth mints it a record with
 * scopes ["*"]. So injecting it unconditionally handed platform-level authority
 * to any anonymous caller with curl. That is not theoretical — two theft paths
 * were confirmed through it:
 *
 *   1. PATCH /agents/:id  — re-point another agent's payout wallet, then let the
 *      settlement scheduler pay you. (Also fixed server-side: wallet changes now
 *      require an admin key.)
 *   2. POST /meter/execute — callerId and calleeId come straight from the body,
 *      and the handler debits the caller's balance and credits the callee's.
 *      Anyone could bill any agent and credit their own.
 *
 * Fixing those one at a time is whack-a-mole: the real problem is the injection.
 * So for money-moving paths we forward whatever credential the CALLER presented
 * and inject nothing. An anonymous request therefore reaches the backend with no
 * key and is rejected 401 — the backend needs no change and cannot be bypassed
 * by a path-matching trick, because a miss here only ever means *less* authority,
 * never more.
 *
 * The dashboard is unaffected: its money calls go through authFetch, which sends
 * the user's own X-API-Key (lib/api.ts). Read-only and public paths still get the
 * injected key, so marketplace/agent pages keep working.
 *
 * The durable fix is real per-user auth plus per-agent keys, so that the platform
 * key stops being a shared credential the dashboard has to hold at all.
 */

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
    externalResolver: true,
  },
};

// Name of the backend's session cookie (authService.SESSION_COOKIE_NAME).
const SESSION_COOKIE = "monocle_session";

// Everything below matches against a NORMALIZED path (lowercased, slashes
// collapsed and trimmed) because Express routes case-insensitively — an earlier
// case-sensitive guard let `/v1/Agents/...` walk straight past it.
function normalizePath(path: string): string {
  return path.toLowerCase().replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

/**
 * Money paths: the injected platform key is WITHHELD here. These move funds, so a
 * caller must present their own (agent-scoped) credential or be rejected 401 by
 * the backend. Withholding fails safe — a path the list misses gets *less*
 * authority, never more.
 */
const MONEY_PATHS: RegExp[] = [
  /^(v1\/)?meter\/execute$/,          // debits caller, credits callee
  /^(v1\/)?payments\/settle(\/|$)/,   // on-chain settlement
  /^(v1\/)?payments\/topup(\/|$)/,    // mints balance
  /^(v1\/)?deposits\/withdraw$/,      // pays out to a wallet
  /^(v1\/)?agents\/[^/]+\/withdraw$/, // pays out to a wallet
];

function movesMoney(path: string): boolean {
  return MONEY_PATHS.some((re) => re.test(normalizePath(path)));
}

/**
 * Sensitive paths: require a signed-in user session (KYC / ownership). A request
 * without the session cookie is refused before the key is injected. Covers agent
 * registration (which links the agent to its owner) on top of the money paths.
 */
const SENSITIVE_PATHS: RegExp[] = [
  /^(v1\/)?payments\/settle(\/|$)/,
  /^(v1\/)?agents\/register$/,
  /^(v1\/)?agents\/[^/]+\/withdraw$/,
  /^(v1\/)?deposits\/withdraw$/,
];

function isSensitive(path: string): boolean {
  return SENSITIVE_PATHS.some((re) => re.test(normalizePath(path)));
}

/**
 * Writes that legitimately have no session, because they are how you get one, or
 * because they are public protocol endpoints agents call without an account.
 *
 * Everything else that changes state requires a signed-in user — see
 * requiresSession below.
 */
const PUBLIC_WRITE_PATHS: RegExp[] = [
  // Sign-up, sign-in, SIWS challenge/verify, code entry. By definition there is
  // no session yet.
  /^(v1\/)?auth\//,
  // x402 quoting and payment verification. Deliberately unauthenticated: the
  // agent checking whether it was paid holds no Monocle credential.
  /^(v1\/)?x402\//,
];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Does this request need a signed-in user before we inject the platform key?
 *
 * DEFAULT-DENY, and that inversion is the point.
 *
 * This used to be an allowlist: only paths named in SENSITIVE_PATHS required a
 * session, and everything else got the platform key injected for free. Which
 * meant PATCH /v1/agents/:id — not on the list, because nobody thought to add
 * it — let an anonymous request edit ANY agent's name, rate, endpoint URL and
 * verified badge. Confirmed against production: the call returned 404 for an
 * unknown agent rather than 401, so authentication had been passed entirely by
 * a caller with no cookie and no key.
 *
 * The bug was not the missing entry. It was that forgetting an entry granted
 * authority rather than withholding it. Now any state-changing method needs a
 * session unless it is explicitly, deliberately public — so the next route
 * added is private until somebody decides otherwise, which is the safer
 * direction to be wrong in.
 *
 * This is defence in depth, not the fix. The backend enforces ownership on
 * those routes now; this stops a future route from being reachable before
 * anybody notices it needs it.
 */
function requiresSession(path: string, method: string): boolean {
  if (isSensitive(path)) return true;
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  return !PUBLIC_WRITE_PATHS.some((re) => re.test(normalizePath(path)));
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "host",
  "content-length",
  // Forwarding these caused the backend's CORS middleware to reject same-server requests.
  "origin",
  "referer",
]);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Read env inside the handler: on Cloudflare Workers (OpenNext) process.env is
  // populated from the Worker's bindings per request, not at module load time.
  const BACKEND = process.env.MONOCLE_BACKEND_URL;
  const API_KEY = process.env.MONOCLE_API_KEY;

  if (!BACKEND) {
    res.status(500).json({
      success: false,
      error: { code: "PROXY_NOT_CONFIGURED", message: "MONOCLE_BACKEND_URL is not set" },
    });
    return;
  }

  const segments = Array.isArray(req.query.path)
    ? req.query.path
    : req.query.path
    ? [req.query.path as string]
    : [];
  const path = segments.join("/");

  // Sensitive actions require a signed-in user. Without this, the x-api-key we
  // inject below would let any anonymous browser request settle/withdraw/register.
  // Presence is checked here; the backend validates the session for real and
  // enforces email verification (KYC).
  if (requiresSession(path, req.method ?? "GET") && !req.cookies?.[SESSION_COOKIE]) {
    res.status(401).json({
      success: false,
      error: {
        code: "AUTH_NOT_SIGNED_IN",
        message: "Sign in and verify your email to perform this action",
      },
    });
    return;
  }

  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === "path") continue;
    if (Array.isArray(v)) v.forEach((x) => search.append(k, x));
    else if (typeof v === "string" && v.length > 0) search.set(k, v);
  }
  const qs = search.toString();
  const upstreamUrl = `${BACKEND.replace(/\/$/, "")}/${path}${qs ? `?${qs}` : ""}`;

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  // Grant platform authority only where it cannot be used to move money. On
  // money paths the caller's own credential (if any) is already forwarded above;
  // an anonymous caller arrives with none and the backend rejects it 401.
  if (API_KEY && !movesMoney(path)) {
    headers.set("x-api-key", API_KEY);
  }

  let body: string | undefined;
  if (req.method && !["GET", "HEAD"].includes(req.method)) {
    if (req.body !== undefined && req.body !== null) {
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (HOP_BY_HOP.has(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    if (upstream.body) {
      // Web Streams API — works in Node.js 18+ and Cloudflare Workers
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        reader.releaseLock();
      }
      res.end();
    } else {
      res.end();
    }
  } catch (err) {
    console.error("[Proxy] Forward to backend failed:", err);
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        error: { code: "PROXY_BAD_GATEWAY", message: "Failed to reach backend" },
      });
    } else {
      res.end();
    }
  }
}
