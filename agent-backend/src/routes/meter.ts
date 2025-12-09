import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { logToolCall } from "../services/meterService";

const router = Router();

router.post("/log", apiKeyAuth, async (req, res) => {
  const { agentId, toolName, tokensUsed = 0, payload } = req.body;
  const result = await logToolCall(agentId, toolName, Number(tokensUsed), payload);
  res.json(result);
});

router.get("/logs", apiKeyAuth, async (_req, res) => {
  const { rows } = await (await import("../db/client")).query(
    "select agent_id, tool_name, tokens_used, cost, timestamp from tool_calls order by timestamp desc limit 100"
  );
  res.json(rows);
});

export default router;

