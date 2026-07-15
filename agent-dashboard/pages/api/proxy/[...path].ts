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

/**
 * Paths where platform authority must never be granted to an anonymous caller.
 *
 * Matched against a normalized path (lowercased, slashes collapsed, leading and
 * trailing slashes stripped) because Express routes case-insensitively: an
 * earlier version of this guard used case-sensitive patterns, and `/v1/Agents/...`
 * walked straight past it. Normalizing here keeps both sides agreeing.
 */
const MONEY_PATHS: RegExp[] = [
  /^(v1\/)?meter\/execute$/,          // debits caller, credits callee
  /^(v1\/)?payments\/settle(\/|$)/,   // on-chain settlement
  /^(v1\/)?payments\/topup(\/|$)/,    // mints balance
  /^(v1\/)?deposits\/withdraw$/,      // pays out to a wallet
  /^(v1\/)?agents\/[^/]+\/withdraw$/, // pays out to a wallet
];

function normalizePath(path: string): string {
  return path.toLowerCase().replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

function movesMoney(path: string): boolean {
  const p = normalizePath(path);
  return MONEY_PATHS.some((re) => re.test(p));
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
