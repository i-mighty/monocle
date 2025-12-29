import { Router } from "express";
import { query } from "../db/client.js";

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

// Total earnings across all payments
router.get("/earnings", async (_req, res) => {
  try {
    const { rows } = await query(
      "select coalesce(sum(amount),0) as total_sol from payments"
    );
    res.json(rows?.[0] || { total_sol: 0 });
  } catch (error) {
    console.error("Error fetching earnings:", error);
    res.status(500).json({ total_sol: 0, error: "Failed to fetch earnings" });
  }
});

// Earnings grouped by receiver (top 50)
router.get("/earnings/by-agent", async (_req, res) => {
  try {
    const { rows } = await query(
      "select receiver, sum(amount) as total_sol, count(*) as payments from payments group by receiver order by total_sol desc limit 50"
    );
    res.json(rows || []);
  } catch (error) {
    console.error("Error fetching earnings by agent:", error);
    res.status(500).json([]);
  }
});

export default router;
