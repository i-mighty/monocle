/**
 * Messaging Service
 *
 * Consent-based agent-to-agent messaging system inspired by Moltbook.
 * Key features:
 * - Request → Approval workflow (no spam)
 * - Private conversations between agents
 * - Human escalation support
 * - Block/follow social features
 */

import { db } from "../db/client";
import {
  conversations,
  messages,
  agentBlocks,
  agentFollows,
  agents,
  Conversation,
  Message,
} from "../db/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";

// =============================================================================
// TYPES
// =============================================================================
export interface ConversationRequest {
  fromAgentId: string;
  toAgentId: string;
  message: string;
}

export interface SendMessageRequest {
  conversationId: string;
  senderAgentId: string;
  content: string;
  needsHumanInput?: boolean;
}

export interface DMCheckResult {
  hasActivity: boolean;
  summary: string;
  pendingRequests: {
    count: number;
    items: Array<{
      conversationId: string;
      from: { id: string; name: string | null };
      messagePreview: string;
      createdAt: Date | null;
    }>;
  };
  unreadMessages: {
    totalUnread: number;
    conversationsWithUnread: number;
  };
}

export interface ConversationWithAgent {
  conversation: Conversation;
  otherAgent: { id: string; name: string | null };
  unreadCount: number;
  youInitiated: boolean;
}

// Helper to ensure db is connected
function getDb() {
  if (!db) throw new Error("Database not connected");
  return db;
}

// =============================================================================
// CONVERSATION REQUESTS
// =============================================================================

/**
 * Send a chat request to another agent
 * Requires approval from the receiver before messages can be exchanged
 */
export async function sendConversationRequest(
  request: ConversationRequest
): Promise<{ success: boolean; conversationId?: string; error?: string }> {
  const database = getDb();
  const { fromAgentId, toAgentId, message } = request;

  // 1. Validate both agents exist
  const [fromAgent, toAgent] = await Promise.all([
    database.select().from(agents).where(eq(agents.id, fromAgentId)).limit(1),
    database.select().from(agents).where(eq(agents.id, toAgentId)).limit(1),
  ]);

  if (!fromAgent.length) {
    return { success: false, error: "Sender agent not found" };
  }
  if (!toAgent.length) {
    return { success: false, error: "Recipient agent not found" };
  }

  // 2. Check if blocked
  const block = await database
    .select()
    .from(agentBlocks)
    .where(
      and(
        eq(agentBlocks.blockerAgentId, toAgentId),
        eq(agentBlocks.blockedAgentId, fromAgentId)
      )
    )
    .limit(1);

  if (block.length > 0) {
    return { success: false, error: "Cannot send request to this agent" };
  }

  // 3. Check for existing conversation (in either direction)
  const existing = await database
    .select()
    .from(conversations)
    .where(
      or(
        and(
          eq(conversations.initiatorAgentId, fromAgentId),
          eq(conversations.receiverAgentId, toAgentId)
        ),
        and(
          eq(conversations.initiatorAgentId, toAgentId),
          eq(conversations.receiverAgentId, fromAgentId)
        )
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const conv = existing[0];
    if (conv.status === "approved") {
      return {
        success: false,
        error: "Conversation already exists",
        conversationId: conv.id,
      };
    }
    if (conv.status === "pending") {
      return { success: false, error: "Request already pending" };
    }
    if (conv.status === "rejected" || conv.status === "blocked") {
      return { success: false, error: "Previous request was declined" };
    }
  }

  // 4. Create conversation request
  const [newConv] = await database
    .insert(conversations)
    .values({
      initiatorAgentId: fromAgentId,
      receiverAgentId: toAgentId,
      requestMessage: message,
      status: "pending",
    })
    .returning();

  return { success: true, conversationId: newConv.id };
}

/**
 * Get pending conversation requests for an agent
 */
export async function getPendingRequests(
  agentId: string
): Promise<Array<{
  conversationId: string;
  from: { id: string; name: string | null };
  messagePreview: string;
  createdAt: Date | null;
}>> {
  const database = getDb();
  
  const pending = await database
    .select({
      conversationId: conversations.id,
      fromId: conversations.initiatorAgentId,
      fromName: agents.name,
      messagePreview: conversations.requestMessage,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .innerJoin(agents, eq(conversations.initiatorAgentId, agents.id))
    .where(
      and(
        eq(conversations.receiverAgentId, agentId),
        eq(conversations.status, "pending")
      )
    )
    .orderBy(desc(conversations.createdAt));

  return pending.map((p) => ({
    conversationId: p.conversationId,
    from: { id: p.fromId, name: p.fromName },
    messagePreview: p.messagePreview,
    createdAt: p.createdAt,
  }));
}

/**
 * Approve a conversation request
 */
export async function approveRequest(
  conversationId: string,
  agentId: string
): Promise<{ success: boolean; error?: string }> {
  const database = getDb();
  
  // Verify this agent is the receiver
  const conv = await database
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.receiverAgentId, agentId),
        eq(conversations.status, "pending")
      )
    )
    .limit(1);

  if (!conv.length) {
    return { success: false, error: "Pending request not found" };
  }

  await database
    .update(conversations)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return { success: true };
}

/**
 * Reject a conversation request (optionally block)
 */
export async function rejectRequest(
  conversationId: string,
  agentId: string,
  block: boolean = false
): Promise<{ success: boolean; error?: string }> {
  const database = getDb();
  
  const conv = await database
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.receiverAgentId, agentId),
        eq(conversations.status, "pending")
      )
    )
    .limit(1);

  if (!conv.length) {
    return { success: false, error: "Pending request not found" };
  }

  const newStatus = block ? "blocked" : "rejected";

  await database
    .update(conversations)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  // If blocking, add to blocks table
  if (block) {
    await database
      .insert(agentBlocks)
      .values({
        blockerAgentId: agentId,
        blockedAgentId: conv[0].initiatorAgentId,
      })
      .onConflictDoNothing();
  }

  return { success: true };
}

// =============================================================================
// ACTIVE CONVERSATIONS
// =============================================================================

/**
 * List all active (approved) conversations for an agent
 */
export async function listConversations(
  agentId: string
): Promise<ConversationWithAgent[]> {
  const database = getDb();
  
  // Get conversations where agent is either initiator or receiver
  const convs = await database
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.status, "approved"),
        or(
          eq(conversations.initiatorAgentId, agentId),
          eq(conversations.receiverAgentId, agentId)
        )
      )
    )
    .orderBy(desc(conversations.lastMessageAt));

  // Get other agent details
  const result: ConversationWithAgent[] = [];

  for (const conv of convs) {
    const isInitiator = conv.initiatorAgentId === agentId;
    const otherAgentId = isInitiator
      ? conv.receiverAgentId
      : conv.initiatorAgentId;

    const [otherAgent] = await database
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.id, otherAgentId))
      .limit(1);

    result.push({
      conversation: conv,
      otherAgent: otherAgent || { id: otherAgentId, name: null },
      unreadCount: isInitiator
        ? conv.initiatorUnreadCount
        : conv.receiverUnreadCount,
      youInitiated: isInitiator,
    });
  }

  return result;
}

/**
 * Get messages in a conversation (marks as read)
 */
export async function getConversationMessages(
  conversationId: string,
  agentId: string
): Promise<{ success: boolean; messages?: Message[]; error?: string }> {
  const database = getDb();
  
  // Verify agent is part of this conversation
  const conv = await database
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.status, "approved"),
        or(
          eq(conversations.initiatorAgentId, agentId),
          eq(conversations.receiverAgentId, agentId)
        )
      )
    )
    .limit(1);

  if (!conv.length) {
    return { success: false, error: "Conversation not found or not approved" };
  }

  // Get messages
  const msgs = await database
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);

  // Mark messages from other agent as read
  await database
    .update(messages)
    .set({ isRead: "true" })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        sql`${messages.senderAgentId} != ${agentId}`,
        eq(messages.isRead, "false")
      )
    );

  // Reset unread count
  const isInitiator = conv[0].initiatorAgentId === agentId;
  if (isInitiator) {
    await database
      .update(conversations)
      .set({ initiatorUnreadCount: 0 })
      .where(eq(conversations.id, conversationId));
  } else {
    await database
      .update(conversations)
      .set({ receiverUnreadCount: 0 })
      .where(eq(conversations.id, conversationId));
  }

  return { success: true, messages: msgs };
}

/**
 * Send a message in an approved conversation
 */
export async function sendMessage(
  request: SendMessageRequest
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const database = getDb();
  const { conversationId, senderAgentId, content, needsHumanInput } = request;

  // Verify conversation exists and is approved
  const conv = await database
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.status, "approved"),
        or(
          eq(conversations.initiatorAgentId, senderAgentId),
          eq(conversations.receiverAgentId, senderAgentId)
        )
      )
    )
    .limit(1);

  if (!conv.length) {
    return { success: false, error: "Conversation not found or not approved" };
  }

  // Insert message
  const [newMsg] = await database
    .insert(messages)
    .values({
      conversationId,
      senderAgentId,
      content,
      needsHumanInput: needsHumanInput ? "true" : "false",
    })
    .returning();

  // Update conversation metadata
  const isInitiator = conv[0].initiatorAgentId === senderAgentId;

  if (isInitiator) {
    // Sender is initiator → increment receiver's unread
    await database
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        receiverUnreadCount: sql`${conversations.receiverUnreadCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
  } else {
    // Sender is receiver → increment initiator's unread
    await database
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        initiatorUnreadCount: sql`${conversations.initiatorUnreadCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
  }

  return { success: true, messageId: newMsg.id };
}

// =============================================================================
// DM CHECK (Heartbeat integration)
// =============================================================================

/**
 * Quick check for DM activity (for heartbeat polling)
 */
export async function checkDMActivity(agentId: string): Promise<DMCheckResult> {
  const database = getDb();
  
  // Count pending requests
  const pendingRequests = await getPendingRequests(agentId);

  // Count unread messages across all conversations
  const unreadConvs = await database
    .select({
      conversationId: conversations.id,
      unreadCount: sql<number>`
        CASE 
          WHEN ${conversations.initiatorAgentId} = ${agentId} 
          THEN ${conversations.initiatorUnreadCount}
          ELSE ${conversations.receiverUnreadCount}
        END
      `.as("unread_count"),
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.status, "approved"),
        or(
          eq(conversations.initiatorAgentId, agentId),
          eq(conversations.receiverAgentId, agentId)
        )
      )
    );

  const totalUnread = unreadConvs.reduce(
    (sum, c) => sum + (c.unreadCount || 0),
    0
  );
  const conversationsWithUnread = unreadConvs.filter(
    (c) => (c.unreadCount || 0) > 0
  ).length;

  const hasActivity = pendingRequests.length > 0 || totalUnread > 0;

  const parts: string[] = [];
  if (pendingRequests.length > 0) {
    parts.push(`${pendingRequests.length} pending request(s)`);
  }
  if (totalUnread > 0) {
    parts.push(`${totalUnread} unread message(s)`);
  }

  return {
    hasActivity,
    summary: parts.length > 0 ? parts.join(", ") : "No activity",
    pendingRequests: {
      count: pendingRequests.length,
      items: pendingRequests,
    },
    unreadMessages: {
      totalUnread,
      conversationsWithUnread,
    },
  };
}

// =============================================================================
// SOCIAL: FOLLOW / BLOCK
// =============================================================================

/**
 * Follow another agent
 */
export async function followAgent(
  followerAgentId: string,
  followingAgentId: string
): Promise<{ success: boolean; error?: string }> {
  const database = getDb();
  
  if (followerAgentId === followingAgentId) {
    return { success: false, error: "Cannot follow yourself" };
  }

  // Check target exists
  const target = await database
    .select()
    .from(agents)
    .where(eq(agents.id, followingAgentId))
    .limit(1);

  if (!target.length) {
    return { success: false, error: "Agent not found" };
  }

  await database
    .insert(agentFollows)
    .values({ followerAgentId, followingAgentId })
    .onConflictDoNothing();

  return { success: true };
}

/**
 * Unfollow an agent
 */
export async function unfollowAgent(
  followerAgentId: string,
  followingAgentId: string
): Promise<{ success: boolean }> {
  const database = getDb();
  
  await database
    .delete(agentFollows)
    .where(
      and(
        eq(agentFollows.followerAgentId, followerAgentId),
        eq(agentFollows.followingAgentId, followingAgentId)
      )
    );

  return { success: true };
}

/**
 * Get agents that an agent is following
 */
export async function getFollowing(
  agentId: string
): Promise<Array<{ id: string; name: string | null }>> {
  const database = getDb();
  
  const following = await database
    .select({
      id: agents.id,
      name: agents.name,
    })
    .from(agentFollows)
    .innerJoin(agents, eq(agentFollows.followingAgentId, agents.id))
    .where(eq(agentFollows.followerAgentId, agentId));

  return following;
}

/**
 * Get an agent's followers
 */
export async function getFollowers(
  agentId: string
): Promise<Array<{ id: string; name: string | null }>> {
  const database = getDb();
  
  const followers = await database
    .select({
      id: agents.id,
      name: agents.name,
    })
    .from(agentFollows)
    .innerJoin(agents, eq(agentFollows.followerAgentId, agents.id))
    .where(eq(agentFollows.followingAgentId, agentId));

  return followers;
}

/**
 * Block an agent
 */
export async function blockAgent(
  blockerAgentId: string,
  blockedAgentId: string
): Promise<{ success: boolean; error?: string }> {
  const database = getDb();
  
  if (blockerAgentId === blockedAgentId) {
    return { success: false, error: "Cannot block yourself" };
  }

  await database
    .insert(agentBlocks)
    .values({ blockerAgentId, blockedAgentId })
    .onConflictDoNothing();

  // Also remove any follow relationship
  await database
    .delete(agentFollows)
    .where(
      or(
        and(
          eq(agentFollows.followerAgentId, blockerAgentId),
          eq(agentFollows.followingAgentId, blockedAgentId)
        ),
        and(
          eq(agentFollows.followerAgentId, blockedAgentId),
          eq(agentFollows.followingAgentId, blockerAgentId)
        )
      )
    );

  return { success: true };
}

/**
 * Unblock an agent
 */
export async function unblockAgent(
  blockerAgentId: string,
  blockedAgentId: string
): Promise<{ success: boolean }> {
  const database = getDb();
  
  await database
    .delete(agentBlocks)
    .where(
      and(
        eq(agentBlocks.blockerAgentId, blockerAgentId),
        eq(agentBlocks.blockedAgentId, blockedAgentId)
      )
    );

  return { success: true };
}

/**
 * Get blocked agents list
 */
export async function getBlockedAgents(
  agentId: string
): Promise<Array<{ id: string; name: string | null }>> {
  const database = getDb();
  
  const blocked = await database
    .select({
      id: agents.id,
      name: agents.name,
    })
    .from(agentBlocks)
    .innerJoin(agents, eq(agentBlocks.blockedAgentId, agents.id))
    .where(eq(agentBlocks.blockerAgentId, agentId));

  return blocked;
}

// =============================================================================
// AGENT DISCOVERY
// =============================================================================

/**
 * Search for agents by name (basic search)
 */
export async function searchAgents(
  query: string,
  limit: number = 20
): Promise<Array<{ id: string; name: string | null; toolCount: number }>> {
  const database = getDb();
  
  const results = await database
    .select({
      id: agents.id,
      name: agents.name,
    })
    .from(agents)
    .where(sql`LOWER(${agents.name}) LIKE LOWER(${`%${query}%`})`)
    .limit(limit);

  // Get tool counts (simplified - just return 0 for now)
  const withToolCounts = results.map((agent) => ({
    ...agent,
    toolCount: 0,
  }));

  return withToolCounts;
}

/**
 * Get agent profile with stats
 */
export async function getAgentProfile(agentId: string): Promise<{
  agent: { id: string; name: string | null } | null;
  stats: {
    toolCount: number;
    followerCount: number;
    followingCount: number;
  };
}> {
  const database = getDb();
  
  const [agent] = await database
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent) {
    return { agent: null, stats: { toolCount: 0, followerCount: 0, followingCount: 0 } };
  }

  // Get stats in parallel
  const [followerResult, followingResult] = await Promise.all([
    database
      .select({ count: sql<number>`count(*)` })
      .from(agentFollows)
      .where(eq(agentFollows.followingAgentId, agentId)),
    database
      .select({ count: sql<number>`count(*)` })
      .from(agentFollows)
      .where(eq(agentFollows.followerAgentId, agentId)),
  ]);

  return {
    agent,
    stats: {
      toolCount: 0, // TODO: Add tool count query
      followerCount: Number(followerResult[0]?.count || 0),
      followingCount: Number(followingResult[0]?.count || 0),
    },
  };
}
