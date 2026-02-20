// =============================================================================
// CHAT ROUTES: Unified AI Interface
// =============================================================================
// Single entry point for all AI interactions. The router automatically
// selects the best specialist agent based on the user's request.
//
// This is the "train" that runs on AgentPay's "rails".
// =============================================================================

import { Router, Request, Response } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { routeRequest, classifyTask, getSpecialistAgents, logRoutingDecision, TaskType } from "../services/routerService";
import { executeChat, calculateCost } from "../services/specialistService";
import { logToolCall } from "../services/meterService";
import { query } from "../db/client";

const router = Router();

// =============================================================================
// POST /chat - Main Chat Endpoint
// =============================================================================
// User sends a message → Router classifies → Best agent executes → Response returned
// AgentPay handles all metering and payment automatically.

router.post("/", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { 
      message, 
      conversationId, 
      preferredTaskType,
      maxCostLamports,
      preferQuality 
    } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        error: "Message is required"
      });
    }

    // Get user ID from API key context (would come from auth in production)
    const userId = (req as any).apiKeyData?.developerId || "anonymous";

    // 1. Route the request to best specialist
    const routingDecision = await routeRequest(message, {
      preferredTaskType,
      maxCostLamports,
      preferQuality
    });

    // 2. Execute through specialist agent
    const chatResponse = await executeChat(
      userId,
      message,
      routingDecision,
      conversationId
    );

    // 3. Record usage in AgentPay ledger (meter the call)
    try {
      // Log the tool call for metering
      await logToolCall(
        "router-agent",
        routingDecision.selectedAgent.agentId,
        `${routingDecision.taskType}-task`,
        chatResponse.usage.totalTokens
      );
    } catch (meterError) {
      // Metering failure shouldn't break the response
      console.error("Failed to record usage:", meterError);
    }

    // 4. Log routing decision for analytics
    await logRoutingDecision(userId, message, routingDecision, {
      success: true,
      latencyMs: chatResponse.latencyMs,
      tokensUsed: chatResponse.usage.totalTokens
    });

    // 5. Return response with full cost transparency
    res.json({
      success: true,
      ...chatResponse,
      routing: {
        taskType: routingDecision.taskType,
        confidence: routingDecision.confidence,
        reasoning: routingDecision.reasoning,
        alternatives: routingDecision.alternativeAgents.map(a => ({
          agentId: a.agentId,
          name: a.name,
          model: a.model,
          ratePer1kTokens: a.ratePer1kTokens
        }))
      }
    });

  } catch (error: any) {
    console.error("Chat error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Chat execution failed"
    });
  }
});

// =============================================================================
// POST /chat/classify - Just Classify (No Execution)
// =============================================================================
// Useful for previewing which agent would handle a request

router.post("/classify", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Message is required"
      });
    }

    const classification = classifyTask(message);
    const agents = await getSpecialistAgents();
    
    // Find agents that handle this task type
    const matchingAgents = agents.filter(a => 
      a.taskTypes.includes(classification.taskType)
    );

    res.json({
      success: true,
      classification: {
        taskType: classification.taskType,
        confidence: classification.confidence
      },
      availableAgents: matchingAgents.map(a => ({
        agentId: a.agentId,
        name: a.name,
        model: a.model,
        provider: a.provider,
        ratePer1kTokens: a.ratePer1kTokens,
        qualityScore: a.qualityScore
      }))
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// POST /chat/preview - Preview Cost Before Execution
// =============================================================================

router.post("/preview", async (req: Request, res: Response) => {
  try {
    const { message, preferredTaskType, maxCostLamports, preferQuality } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Message is required"
      });
    }

    // Get routing decision without executing
    const routingDecision = await routeRequest(message, {
      preferredTaskType,
      maxCostLamports,
      preferQuality
    });

    // Estimate tokens (rough: ~4 chars per token)
    const estimatedInputTokens = Math.ceil(message.length / 4);
    const estimatedOutputTokens = 500; // Average response size
    const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;

    // Calculate estimated cost
    const cost = calculateCost(routingDecision.selectedAgent, estimatedTotalTokens);

    res.json({
      success: true,
      preview: {
        taskType: routingDecision.taskType,
        confidence: routingDecision.confidence,
        selectedAgent: {
          agentId: routingDecision.selectedAgent.agentId,
          name: routingDecision.selectedAgent.name,
          model: routingDecision.selectedAgent.model,
          provider: routingDecision.selectedAgent.provider
        },
        estimatedCost: {
          tokens: estimatedTotalTokens,
          agentCost: cost.agentCost,
          platformFee: cost.platformFee,
          totalLamports: cost.totalCost,
          totalSOL: cost.totalCost / 1e9
        },
        alternatives: routingDecision.alternativeAgents.slice(0, 3).map(a => ({
          name: a.name,
          model: a.model,
          estimatedCost: calculateCost(a, estimatedTotalTokens).totalCost
        }))
      }
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// GET /chat/agents - List All Specialist Agents
// =============================================================================

router.get("/agents", async (req: Request, res: Response) => {
  try {
    const agents = await getSpecialistAgents();

    // Group by task type
    const byTaskType: Record<string, typeof agents> = {};
    for (const agent of agents) {
      for (const taskType of agent.taskTypes) {
        if (!byTaskType[taskType]) byTaskType[taskType] = [];
        byTaskType[taskType].push(agent);
      }
    }

    res.json({
      success: true,
      totalAgents: agents.length,
      taskTypes: Object.keys(byTaskType),
      agents: agents.map(a => ({
        agentId: a.agentId,
        name: a.name,
        description: a.description,
        taskTypes: a.taskTypes,
        provider: a.provider,
        model: a.model,
        pricing: {
          ratePer1kTokens: a.ratePer1kTokens,
          rateSOLPer1kTokens: a.ratePer1kTokens / 1e9
        },
        metrics: {
          qualityScore: a.qualityScore,
          reliabilityScore: a.reliabilityScore,
          avgLatencyMs: a.avgLatencyMs
        }
      })),
      byTaskType: Object.fromEntries(
        Object.entries(byTaskType).map(([type, typeAgents]) => [
          type,
          typeAgents.map(a => ({ name: a.name, model: a.model, rate: a.ratePer1kTokens }))
        ])
      )
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// GET /chat/conversations/:conversationId - Get Conversation History
// =============================================================================

router.get("/conversations/:conversationId", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = (req as any).apiKeyData?.developerId || "anonymous";

    const result = await query(`
      SELECT * FROM conversations_ai 
      WHERE id = $1 AND user_id = $2
    `, [conversationId, userId]);

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found"
      });
    }

    const conv = result.rows[0];

    res.json({
      success: true,
      conversation: {
        id: conv.id,
        messages: JSON.parse(conv.messages || "[]"),
        totalTokens: conv.total_tokens,
        totalCostLamports: conv.total_cost_lamports,
        totalCostSOL: conv.total_cost_lamports / 1e9,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at
      }
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// GET /chat/history - List User's Conversations
// =============================================================================

router.get("/history", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiKeyData?.developerId || "anonymous";
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await query(`
      SELECT id, total_tokens, total_cost_lamports, created_at, updated_at,
             (SELECT COUNT(*) FROM jsonb_array_elements(messages::jsonb)) as message_count
      FROM conversations_ai 
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2
    `, [userId, limit]);

    res.json({
      success: true,
      conversations: result.rows.map((c: any) => ({
        id: c.id,
        messageCount: c.message_count || 0,
        totalTokens: c.total_tokens,
        totalCostLamports: c.total_cost_lamports,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      }))
    });

  } catch (error: any) {
    // If table doesn't exist, return empty
    res.json({
      success: true,
      conversations: []
    });
  }
});

// =============================================================================
// GET /chat/stats - User's Usage Statistics
// =============================================================================

router.get("/stats", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).apiKeyData?.developerId || "anonymous";

    // Get aggregate stats
    const result = await query(`
      SELECT 
        COUNT(*) as conversation_count,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(total_cost_lamports), 0) as total_cost
      FROM conversations_ai 
      WHERE user_id = $1
    `, [userId]);

    const stats = result.rows[0] || { conversation_count: 0, total_tokens: 0, total_cost: 0 };

    res.json({
      success: true,
      stats: {
        totalConversations: parseInt(stats.conversation_count),
        totalTokensUsed: parseInt(stats.total_tokens),
        totalCostLamports: parseInt(stats.total_cost),
        totalCostSOL: parseInt(stats.total_cost) / 1e9
      }
    });

  } catch (error: any) {
    res.json({
      success: true,
      stats: {
        totalConversations: 0,
        totalTokensUsed: 0,
        totalCostLamports: 0,
        totalCostSOL: 0
      }
    });
  }
});

export default router;
