import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";

/**
 * Server-side proxy to the Monocle backend.
 *
 * The dashboard's browser code calls /api/proxy/<...> (same origin). This
 * handler runs on the Next.js server, injects x-api-key from a server-only
 * env var, and forwards to the backend. The API key never ships to clients.
 *
 * Streaming responses (SSE for chat) are piped through, not buffered.
 */

const BACKEND = process.env.MONOCLE_BACKEND_URL;
const API_KEY = process.env.MONOCLE_API_KEY;

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

  // Rebuild query string excluding the catch-all 'path' segments
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === "path") continue;
    if (Array.isArray(v)) v.forEach((x) => search.append(k, x));
    else if (typeof v === "string" && v.length > 0) search.set(k, v);
  }
  const qs = search.toString();
  const upstreamUrl = `${BACKEND.replace(/\/$/, "")}/${path}${qs ? `?${qs}` : ""}`;

  // Forwarded headers
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  if (API_KEY) headers.set("x-api-key", API_KEY);

  // Body
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
      // @ts-expect-error: undici fetch accepts duplex
      duplex: "half",
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (HOP_BY_HOP.has(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body as any);
      nodeStream.pipe(res);
      nodeStream.on("error", (err) => {
        console.error("[Proxy] Stream error:", err);
        res.end();
      });
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
