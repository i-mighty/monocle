/**
 * Arena routes — public, read-mostly API over the TxLINE Agent-vs-Agent Arena.
 *
 * GET  /arena/overview         scoreboard: both agents, PnL, leader, mode
 * GET  /arena/matches          latest consensus snapshot for every fixture
 * GET  /arena/matches/:id      one fixture + probability history + positions
 * GET  /arena/positions        positions (filter ?status=open|settled&agentId=)
 * GET  /arena/signals          recent strategy signals (?limit=)
 * GET  /arena/settlements      recent on-chain / internal settlements (?limit=)
 * POST /arena/tick             advance the loop one step (manual/demo, admin)
 * POST /arena/start            start the autonomous loop (admin)
 * POST /arena/stop             stop the loop (admin)
 * POST /arena/reset            clear positions/signals, reset bankrolls (admin)
 *
 * Read endpoints are intentionally public so judges can poll without keys.
 * Mutating endpoints require the admin API key.
 */

import { Router } from "express";
import { getArena } from "../arena/engine";
import { adminKeyAuth } from "../middleware/adminAuth";

const router = Router();
const arena = getArena();

router.get("/overview", (_req, res) => {
  res.json({ success: true, data: arena.getOverview() });
});

router.get("/matches", (_req, res) => {
  res.json({ success: true, data: arena.getMatches() });
});

router.get("/matches/:id", (req, res) => {
  const fixtureId = Number(req.params.id);
  if (!Number.isFinite(fixtureId)) {
    return res.status(400).json({ success: false, error: "invalid fixture id" });
  }
  const match = arena.getMatch(fixtureId);
  if (!match) return res.status(404).json({ success: false, error: "fixture not found" });
  res.json({ success: true, data: match });
});

router.get("/positions", (req, res) => {
  const status = req.query.status === "open" || req.query.status === "settled" ? req.query.status : undefined;
  const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  res.json({ success: true, data: arena.getPositions({ status, agentId }) });
});

router.get("/signals", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ success: true, data: arena.getSignals(limit) });
});

router.get("/settlements", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ success: true, data: arena.getSettlements(limit) });
});

// ---------------------------------------------------------------------------
// Mutating / control endpoints (admin only)
// ---------------------------------------------------------------------------

router.post("/tick", adminKeyAuth, async (_req, res) => {
  try {
    const tick = await arena.tick();
    res.json({
      success: true,
      data: { at: tick.at, snapshots: tick.snapshots.length, resolved: tick.resolved.length, overview: arena.getOverview() },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message ?? "tick failed" });
  }
});

router.post("/start", adminKeyAuth, (_req, res) => {
  arena.start();
  res.json({ success: true, data: arena.getOverview() });
});

router.post("/stop", adminKeyAuth, (_req, res) => {
  arena.stop();
  res.json({ success: true, data: { stopped: true } });
});

router.post("/reset", adminKeyAuth, (_req, res) => {
  arena.reset();
  res.json({ success: true, data: arena.getOverview() });
});

export default router;
