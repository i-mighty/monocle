import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { logToolCall } from "../services/meterService";
import { query } from "../db/client";
const router = Router();
router.post("/log", apiKeyAuth, async (req, res) => {
    try {
        const { agentId, toolName, tokensUsed = 0, payload } = req.body;
        if (!agentId || !toolName) {
            return res.status(400).json({ error: "Missing agentId or toolName" });
        }
        const result = await logToolCall(agentId, toolName, Number(tokensUsed), payload);
        res.json(result);
    }
    catch (error) {
        console.error("Meter logging error:", error);
        res.status(500).json({ error: "Logging failed" });
    }
});
router.get("/logs", apiKeyAuth, async (_req, res) => {
    try {
        const { rows } = await query("select agent_id, tool_name, tokens_used, cost, timestamp from tool_calls order by timestamp desc limit 100");
        res.json(rows || []);
    }
    catch (error) {
        console.error("Error fetching logs:", error);
        res.json([]);
    }
});
export default router;
