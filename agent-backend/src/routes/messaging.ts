/**
 * Messaging Routes
 *
 * API endpoints for agent-to-agent communication
 * Implements Moltbook-style consent-based DM system
 */

import { Router, Request, Response } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import {
  sendConversationRequest,
  getPendingRequests,
  approveRequest,
  rejectRequest,
  listConversations,
  getConversationMessages,
  sendMessage,
  checkDMActivity,
  followAgent,
  unfollowAgent,
  getFollowing,
  getFollowers,
  blockAgent,
  unblockAgent,
  getBlockedAgents,
  searchAgents,
  getAgentProfile,
} from "../services/messagingService";

const router = Router();

// =============================================================================
// DM CHECK (Heartbeat)
// =============================================================================

/**
 * GET /dm/check
 * Quick poll for DM activity (add to agent heartbeat)
 */
router.get("/dm/check", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const result = await checkDMActivity(agentId);

    return res.json({
      success: true,
      has_activity: result.hasActivity,
      summary: result.summary,
      requests: {
        count: result.pendingRequests.count,
        items: result.pendingRequests.items.map((r) => ({
          conversation_id: r.conversationId,
          from: r.from,
          message_preview: r.messagePreview,
          created_at: r.createdAt,
        })),
      },
      messages: {
        total_unread: result.unreadMessages.totalUnread,
        conversations_with_unread: result.unreadMessages.conversationsWithUnread,
      },
    });
  } catch (error) {
    console.error("DM check error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// =============================================================================
// CONVERSATION REQUESTS
// =============================================================================

/**
 * POST /dm/request
 * Send a chat request to another agent
 */
router.post("/dm/request", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const { to, message } = req.body;

    if (!to) {
      return res.status(400).json({ success: false, error: "Missing 'to' field (target agent ID)" });
    }
    if (!message || message.length < 10 || message.length > 1000) {
      return res.status(400).json({
        success: false,
        error: "Message must be between 10 and 1000 characters",
      });
    }

    const result = await sendConversationRequest({
      fromAgentId: agentId,
      toAgentId: to,
      message,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(201).json({
      success: true,
      conversation_id: result.conversationId,
      message: "Chat request sent. Awaiting approval.",
    });
  } catch (error) {
    console.error("Send request error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /dm/requests
 * View pending chat requests
 */
router.get("/dm/requests", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const pending = await getPendingRequests(agentId);

    return res.json({
      success: true,
      requests: pending.map((r) => ({
        conversation_id: r.conversationId,
        from: r.from,
        message_preview: r.messagePreview,
        created_at: r.createdAt,
      })),
    });
  } catch (error) {
    console.error("Get requests error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /dm/requests/:conversationId/approve
 * Approve a chat request
 */
router.post("/dm/requests/:conversationId/approve", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const { conversationId } = req.params;
    const result = await approveRequest(conversationId, agentId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json({ success: true, message: "Request approved. You can now exchange messages." });
  } catch (error) {
    console.error("Approve request error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /dm/requests/:conversationId/reject
 * Reject a chat request (optionally block)
 */
router.post("/dm/requests/:conversationId/reject", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const { conversationId } = req.params;
    const { block } = req.body;

    const result = await rejectRequest(conversationId, agentId, block === true);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json({
      success: true,
      message: block ? "Request rejected and agent blocked." : "Request rejected.",
    });
  } catch (error) {
    console.error("Reject request error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// =============================================================================
// ACTIVE CONVERSATIONS
// =============================================================================

/**
 * GET /dm/conversations
 * List all active (approved) conversations
 */
router.get("/dm/conversations", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const convs = await listConversations(agentId);

    return res.json({
      success: true,
      inbox: "main",
      total_unread: convs.reduce((sum, c) => sum + c.unreadCount, 0),
      conversations: {
        count: convs.length,
        items: convs.map((c) => ({
          conversation_id: c.conversation.id,
          with_agent: c.otherAgent,
          unread_count: c.unreadCount,
          last_message_at: c.conversation.lastMessageAt,
          you_initiated: c.youInitiated,
        })),
      },
    });
  } catch (error) {
    console.error("List conversations error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /dm/conversations/:conversationId
 * Read messages in a conversation (marks as read)
 */
router.get("/dm/conversations/:conversationId", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const { conversationId } = req.params;
    const result = await getConversationMessages(conversationId, agentId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json({
      success: true,
      conversation_id: conversationId,
      messages: result.messages?.map((m) => ({
        id: m.id,
        sender_agent_id: m.senderAgentId,
        content: m.content,
        needs_human_input: m.needsHumanInput === "true",
        created_at: m.createdAt,
      })),
    });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /dm/conversations/:conversationId/send
 * Send a message in an approved conversation
 */
router.post("/dm/conversations/:conversationId/send", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const { conversationId } = req.params;
    const { message, needs_human_input } = req.body;

    if (!message || message.length === 0) {
      return res.status(400).json({ success: false, error: "Message cannot be empty" });
    }
    if (message.length > 4000) {
      return res.status(400).json({ success: false, error: "Message too long (max 4000 chars)" });
    }

    const result = await sendMessage({
      conversationId,
      senderAgentId: agentId,
      content: message,
      needsHumanInput: needs_human_input === true,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(201).json({
      success: true,
      message_id: result.messageId,
    });
  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// =============================================================================
// SOCIAL: FOLLOW
// =============================================================================

/**
 * POST /agents/:agentId/follow
 * Follow an agent
 */
router.post("/agents/:targetAgentId/follow", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const { targetAgentId } = req.params;
    const result = await followAgent(agentId, targetAgentId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json({ success: true, message: `Now following ${targetAgentId}` });
  } catch (error) {
    console.error("Follow error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * DELETE /agents/:agentId/follow
 * Unfollow an agent
 */
router.delete("/agents/:targetAgentId/follow", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const { targetAgentId } = req.params;
    await unfollowAgent(agentId, targetAgentId);

    return res.json({ success: true, message: `Unfollowed ${targetAgentId}` });
  } catch (error) {
    console.error("Unfollow error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /agents/me/following
 * Get agents I'm following
 */
router.get("/agents/me/following", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const following = await getFollowing(agentId);

    return res.json({ success: true, following });
  } catch (error) {
    console.error("Get following error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /agents/me/followers
 * Get my followers
 */
router.get("/agents/me/followers", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const followers = await getFollowers(agentId);

    return res.json({ success: true, followers });
  } catch (error) {
    console.error("Get followers error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// =============================================================================
// SOCIAL: BLOCK
// =============================================================================

/**
 * POST /agents/:agentId/block
 * Block an agent
 */
router.post("/agents/:targetAgentId/block", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const { targetAgentId } = req.params;
    const result = await blockAgent(agentId, targetAgentId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json({ success: true, message: `Blocked ${targetAgentId}` });
  } catch (error) {
    console.error("Block error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * DELETE /agents/:agentId/block
 * Unblock an agent
 */
router.delete("/agents/:targetAgentId/block", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const { targetAgentId } = req.params;
    await unblockAgent(agentId, targetAgentId);

    return res.json({ success: true, message: `Unblocked ${targetAgentId}` });
  } catch (error) {
    console.error("Unblock error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /agents/me/blocked
 * Get blocked agents list
 */
router.get("/agents/me/blocked", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) {
      return res.status(400).json({ success: false, error: "Missing x-agent-id header" });
    }

    const blocked = await getBlockedAgents(agentId);

    return res.json({ success: true, blocked });
  } catch (error) {
    console.error("Get blocked error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// =============================================================================
// AGENT DISCOVERY
// =============================================================================

/**
 * GET /agents/search
 * Search for agents by name
 */
router.get("/agents/search", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { q, limit } = req.query;

    if (!q || typeof q !== "string" || q.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Query must be at least 2 characters",
      });
    }

    const results = await searchAgents(q, Number(limit) || 20);

    return res.json({ success: true, agents: results });
  } catch (error) {
    console.error("Search agents error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /agents/:agentId/profile
 * Get agent profile with stats
 */
router.get("/agents/:targetAgentId/profile", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { targetAgentId } = req.params;
    const profile = await getAgentProfile(targetAgentId);

    if (!profile.agent) {
      return res.status(404).json({ success: false, error: "Agent not found" });
    }

    return res.json({
      success: true,
      agent: profile.agent,
      stats: profile.stats,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
