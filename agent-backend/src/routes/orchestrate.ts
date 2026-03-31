/**
 * routes/orchestrate.ts
 *
 * POST /v1/orchestrate — Multi-agent orchestration endpoint
 * GET  /v1/orchestrate/:sessionId/stream — SSE stream of agent events
 * GET  /v1/orchestrate/:sessionId — Get session status + results
 *
 * Mount in app.ts:
 *   import orchestrateRouter from "./routes/orchestrate";
 *   app.use("/v1/orchestrate", apiKeyAuth, orchestrateRouter);
 */

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { orchestrateTask } from "../services/agentOrchestrationService";
import { negotiationEvents } from "../services/agentNegotiationService";
import { query } from "../db/client";

const router = Router();

// ─── POST /v1/orchestrate ─────────────────────────────────────────────────────
// Starts a multi-agent orchestration session. Returns sessionId immediately,
// then streams events via GET /v1/orchestrate/:sessionId/stream
router.post("/", async (req: Request, res: Response) => {
  const { message, userId = "anonymous", stream = true } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  const sessionId = `orch_${uuidv4().replace(/-/g, "").slice(0, 16)}`;

  if (!stream) {
    // Blocking mode — wait for full result (not recommended for UI)
    try {
      const result = await orchestrateTask(sessionId, message, userId);
      return res.json({ success: true, sessionId, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  }

  // Streaming mode — return sessionId, let client subscribe to SSE
  res.json({ success: true, sessionId, streamUrl: `/v1/orchestrate/${sessionId}/stream` });

  // Start orchestration in background
  setImmediate(async () => {
    try {
      await orchestrateTask(sessionId, message, userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Orchestration ${sessionId} failed:`, msg);
      negotiationEvents.emit(`session:${sessionId}`, {
        type: "session_failed",
        sessionId,
        error: msg,
        timestamp: new Date().toISOString(),
      });
    }
  });
});

// ─── GET /v1/orchestrate/:sessionId/stream ────────────────────────────────────
// SSE stream of all agent events for a session
router.get("/:sessionId/stream", async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send current session state immediately
  try {
    const session = await query(
      `SELECT * FROM orchestration_sessions WHERE id = $1`, [sessionId]
    );
    if (session.rows.length > 0) {
      send({ type: "session_status", session: session.rows[0] });
    }

    // Send existing messages
    const messages = await query(
      `SELECT * FROM agent_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );
    for (const msg of messages.rows) {
      send({ type: "historical_message", message: msg });
    }
  } catch {
    // Session may not exist yet — fine
  }

  // Subscribe to live events
  const handler = (event: object) => {
    send(event);

    // Close stream when session completes or fails
    const e = event as { type?: string };
    if (e.type === "session_complete" || e.type === "session_failed") {
      send({ type: "stream_end" });
      setTimeout(() => res.end(), 500);
    }
  };

  negotiationEvents.on(`session:${sessionId}`, handler);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    negotiationEvents.off(`session:${sessionId}`, handler);
  });
});

// ─── GET /v1/orchestrate/:sessionId ──────────────────────────────────────────
// Get final session result + full message log
router.get("/:sessionId", async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const [session, messages, subtasks, negotiations] = await Promise.all([
      query(`SELECT * FROM orchestration_sessions WHERE id = $1`, [sessionId]),
      query(`SELECT * FROM agent_messages WHERE session_id = $1 ORDER BY created_at ASC`, [sessionId]),
      query(`SELECT * FROM orchestration_subtasks WHERE session_id = $1 ORDER BY created_at ASC`, [sessionId]),
      query(`SELECT * FROM agent_negotiations WHERE session_id = $1 ORDER BY created_at ASC`, [sessionId]),
    ]);

    if (session.rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    return res.json({
      session: session.rows[0],
      messages: messages.rows,
      subtasks: subtasks.rows,
      negotiations: negotiations.rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

export default router;
