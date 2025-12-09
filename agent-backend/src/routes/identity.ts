import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { verifyIdentity } from "../services/identityService";

const router = Router();

router.post("/verify-identity", apiKeyAuth, async (req, res) => {
  const { firstName, lastName, dob, idNumber } = req.body;
  const result = await verifyIdentity({ firstName, lastName, dob, idNumber });
  res.json(result);
});

export default router;

