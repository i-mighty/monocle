import { Router } from "express";
import { query } from "../db/client";

const router = Router();

router.get("/usage", async (_req, res) => {
  try {
    const { rows } = await query(
      "select agent_id, count(*) as calls, sum(cost) as spend from tool_calls group by agent_id order by spend desc limit 50"
    );
    res.json(rows || []);
  } catch (error) {
    console.error("Error fetching usage:", error);
    res.json([]);
  }
});

router.get("/receipts", async (_req, res) => {
  try {
    const { rows } = await query(
      "select id, sender, receiver, amount, tx_signature, timestamp from payments order by timestamp desc limit 100"
    );
    res.json(rows || []);
  } catch (error) {
    console.error("Error fetching receipts:", error);
    res.json([]);
  }
});

export default router;

