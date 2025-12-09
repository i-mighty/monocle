import { Router } from "express";
import { logToolCall } from "../services/meterService";

const router = Router();

router.post("/log", async (req, res) => {
  const { agentId, toolName, payload } = req.body;
  const result = await logToolCall(agentId, toolName, payload);
  res.json(result);
});

export default router;

