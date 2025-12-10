import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { verifyIdentity } from "../services/identityService";

const router = Router();

router.post("/verify-identity", apiKeyAuth, async (req, res) => {
  try {
    const { firstName, lastName, dob, idNumber } = req.body;
    if (!firstName || !lastName || !dob || !idNumber) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const result = await verifyIdentity({ firstName, lastName, dob, idNumber });
    res.json(result);
  } catch (error) {
    console.error("Identity verification error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
});

export default router;

