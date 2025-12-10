import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { sendMicropayment } from "../services/solanaService";
import { query } from "../db/client";
const router = Router();
router.post("/pay", apiKeyAuth, async (req, res) => {
    try {
        const { sender, receiver, lamports } = req.body;
        if (!sender || !receiver || !lamports) {
            return res.status(400).json({ error: "Missing sender, receiver, or lamports" });
        }
        const lamportsNum = Math.floor(Number(lamports));
        const signature = await sendMicropayment(sender, receiver, lamportsNum);
        res.json({ signature });
    }
    catch (error) {
        console.error("Payment error:", error);
        res.status(500).json({ error: error.message || "Payment failed" });
    }
});
router.get("/", apiKeyAuth, async (_req, res) => {
    try {
        const { rows } = await query("select id, sender, receiver, amount, tx_signature, timestamp from payments order by timestamp desc limit 100");
        res.json(rows || []);
    }
    catch (error) {
        console.error("Error fetching payments:", error);
        res.json([]);
    }
});
export default router;
