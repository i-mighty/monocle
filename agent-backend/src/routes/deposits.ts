/**
 * Deposit Routes
 * 
 * Handles SOL deposits to fund agent accounts.
 * 
 * Endpoints:
 * - GET /deposits/address - Get treasury address for deposits
 * - POST /deposits/intent - Create a deposit intent (get payment instructions)
 * - POST /deposits/verify - Verify a deposit transaction
 * - GET /deposits/:agentId - Get deposit history
 * - GET /deposits/:agentId/pending - Get pending deposit intents
 * - POST /deposits/scan - Scan for unprocessed deposits (admin)
 * - POST /withdrawals - Withdraw to external wallet
 */

import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import {
  getTreasuryAddress,
  createDepositIntent,
  verifyDeposit,
  scanForDeposits,
  getDepositHistory,
  getPendingDeposits,
  withdrawToWallet
} from "../services/depositService";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

const router = Router();

/**
 * GET /deposits/address
 * 
 * Get the platform's treasury address for deposits.
 * This is a public endpoint - no auth required for viewing address.
 */
router.get("/address", (_req, res) => {
  try {
    const address = getTreasuryAddress();
    res.json({
      success: true,
      depositAddress: address,
      network: process.env.SOLANA_RPC?.includes("devnet") ? "devnet" : "mainnet",
      instructions: "Send SOL to this address. Then verify the deposit with POST /deposits/verify",
      minDeposit: 10000, // 0.00001 SOL
      minDepositSOL: 0.00001
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * POST /deposits/intent
 * 
 * Create a deposit intent for an agent.
 * Returns payment instructions and QR code data.
 * 
 * Body: { agentId: string, amountLamports?: number }
 */
router.post("/intent", apiKeyAuth, async (req, res) => {
  try {
    const { agentId, amountLamports, amountSOL } = req.body;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: "agentId is required"
      });
    }

    // Allow specifying amount in SOL or lamports
    const amount = amountLamports || (amountSOL ? Math.floor(amountSOL * LAMPORTS_PER_SOL) : undefined);

    const intent = await createDepositIntent(agentId, amount);

    res.json({
      success: true,
      agentId,
      ...intent,
      amountSOL: amount ? amount / LAMPORTS_PER_SOL : null,
      network: process.env.SOLANA_RPC?.includes("devnet") ? "devnet" : "mainnet"
    });
  } catch (error) {
    console.error("Deposit intent error:", error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * POST /deposits/verify
 * 
 * Verify a deposit transaction and credit the agent's balance.
 * 
 * Body: { txSignature: string, agentId: string }
 */
router.post("/verify", apiKeyAuth, async (req, res) => {
  try {
    const { txSignature, agentId } = req.body;

    if (!txSignature || !agentId) {
      return res.status(400).json({
        success: false,
        error: "txSignature and agentId are required"
      });
    }

    const result = await verifyDeposit(txSignature, agentId);

    if (result.success) {
      res.json({
        success: true,
        message: result.alreadyCredited 
          ? "Deposit already credited" 
          : "Deposit verified and credited",
        amountLamports: result.amountLamports,
        amountSOL: result.amountLamports / LAMPORTS_PER_SOL,
        txSignature,
        agentId
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || "Deposit verification failed"
      });
    }
  } catch (error) {
    console.error("Deposit verify error:", error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * GET /deposits/:agentId
 * 
 * Get deposit history for an agent.
 */
router.get("/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const history = await getDepositHistory(agentId, limit);

    res.json({
      success: true,
      agentId,
      count: history.length,
      deposits: history
    });
  } catch (error) {
    console.error("Deposit history error:", error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * GET /deposits/:agentId/pending
 * 
 * Get pending deposit intents for an agent.
 */
router.get("/:agentId/pending", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    const pending = await getPendingDeposits(agentId);

    res.json({
      success: true,
      agentId,
      count: pending.length,
      pendingDeposits: pending
    });
  } catch (error) {
    console.error("Pending deposits error:", error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * POST /deposits/scan
 * 
 * Scan for unprocessed deposits (admin/background job).
 * This checks recent transactions to the treasury.
 */
router.post("/scan", apiKeyAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const result = await scanForDeposits(limit);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Deposit scan error:", error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * POST /withdrawals
 * 
 * Withdraw SOL from agent's balance to their external wallet.
 * 
 * Body: { agentId: string, amountLamports: number }
 */
router.post("/withdraw", apiKeyAuth, async (req, res) => {
  try {
    const { agentId, amountLamports, amountSOL } = req.body;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: "agentId is required"
      });
    }

    // Allow specifying amount in SOL or lamports
    const amount = amountLamports || (amountSOL ? Math.floor(amountSOL * LAMPORTS_PER_SOL) : 0);

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Positive amount required"
      });
    }

    const result = await withdrawToWallet(agentId, amount);

    if (result.success) {
      res.json({
        success: true,
        message: "Withdrawal successful",
        txSignature: result.txSignature,
        amountLamports: amount,
        amountSOL: amount / LAMPORTS_PER_SOL,
        agentId
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || "Withdrawal failed"
      });
    }
  } catch (error) {
    console.error("Withdrawal error:", error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

export default router;
