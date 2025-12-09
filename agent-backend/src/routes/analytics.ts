import { Router } from "express";
import { query } from "../db/client";

const router = Router();

router.get("/usage", async (_req, res) => {
  const { rows } = await query("select agent_id, count(*) as calls, sum(cost) as spend from tool_calls group by agent_id");
  res.json(rows);
});

router.get("/receipts", async (_req, res) => {
  const { rows } = await query("select * from payments order by timestamp desc limit 100");
  res.json(rows);
});

export default router;

