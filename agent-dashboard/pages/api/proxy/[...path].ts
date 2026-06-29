import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Server-side proxy to the Monocle backend.
 *
 * Injects x-api-key from a server-only env var so the key never ships to
 * the browser. Streaming responses (SSE for chat) are forwarded chunk-by-chunk
 * using the Web Streams API (compatible with Node.js 18+ and Cloudflare Workers).
 */

const BACKEND = process.env.MONOCLE_BACKEND_URL;
const API_KEY = process.env.MONOCLE_API_KEY;

export const runtime = "edge";

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
    externalResolver: true,
  },
};

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
