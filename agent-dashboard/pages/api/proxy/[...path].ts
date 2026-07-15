import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Server-side proxy to the Monocle backend.
 *
 * Injects x-api-key from a server-only env var so the key never ships to
 * the browser. Streaming responses (SSE for chat) are forwarded chunk-by-chunk
 * using the Web Streams API (compatible with Node.js 18+ and Cloudflare Workers).
 */

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
    externalResolver: true,
  },
};

// Name of the backend's session cookie (authService.SESSION_COOKIE_NAME).
const SESSION_COOKIE = "monocle_session";

/**
 * Sensitive actions that must not be reachable on the injected platform API key
 * alone. Because this proxy adds x-api-key server-side, any browser hitting it
 * would otherwise inherit platform-level authority — including users who never
 * signed in. Requiring a session cookie here forces these through the backend's
 * email-verification (KYC) gate, which rejects unverified or invalid sessions.
 *
 * Matched against the forwarded path, with or without the /v1 prefix (the
 * backend still mounts deprecated unprefixed aliases). These are static, so
 * unlike the env vars they can safely live at module scope.
 */
const SENSITIVE_PATHS: RegExp[] = [
  /^(v1\/)?payments\/settle(\/|$)/,
  /^(v1\/)?agents\/register$/,
  /^(v1\/)?agents\/[^/]+\/withdraw$/,
  /^(v1\/)?deposits\/withdraw$/,
];

function isSensitive(path: string): boolean {
  return SENSITIVE_PATHS.some((re) => re.test(path));
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
  if (isSensitive(path) && !req.cookies?.[SESSION_COOKIE]) {
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
  if (API_KEY) headers.set("x-api-key", API_KEY);

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
