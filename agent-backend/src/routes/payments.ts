import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { sendMicropayment } from "../services/solanaService";
import { query } from "../db/client";

const router = Router();

router.post("/pay", apiKeyAuth, async (req, res) => {
  const { sender, receiver, lamports } = req.body;
  const lamportsNum = Math.floor(Number(lamports));
  const signature = await sendMicropayment(sender, receiver, lamportsNum);
  res.json({ signature });
});

router.get("/", apiKeyAuth, async (_req, res) => {
  const { rows } = await query("select sender, receiver, amount, tx_signature, timestamp from payments order by timestamp desc limit 100");
  res.json(rows);
});

export default router;

