import { Router } from "express";
import { sendMicropayment } from "../services/solanaService";

const router = Router();

router.post("/transfer", async (req, res) => {
  const { sender, receiver, amount } = req.body;
  const lamports = Math.floor(Number(amount) * 1e9);
  const signature = await sendMicropayment(sender, receiver, lamports);
  res.json({ signature });
});

export default router;

