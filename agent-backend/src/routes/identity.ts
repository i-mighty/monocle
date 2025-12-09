import { Router } from "express";
import { verifyAgent } from "../services/identityService";

const router = Router();

router.post("/verify", async (req, res) => {
  const { agentId } = req.body;
  const valid = await verifyAgent(agentId);
  res.json({ valid, agentId });
});

export default router;

