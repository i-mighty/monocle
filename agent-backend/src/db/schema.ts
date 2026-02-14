/**
 * Drizzle ORM Schema Definition
 *
 * This schema supports:
 * - Agent registration & balance tracking
 * - Per-tool pricing (each tool has its own rate)
 * - Immutable tool usage ledger
 * - Settlement tracking
 * - Platform revenue accounting
 */

import {
  pgTable,
  text,
  bigint,
  integer,
  uuid,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// =============================================================================
// AGENTS: Agent registration & balance tracking
// =============================================================================
export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").unique(),

    // Default rate (used when tool doesn't specify its own rate)
    defaultRatePer1kTokens: bigint("default_rate_per_1k_tokens", { mode: "number" })
      .notNull()
      .default(1000),

    // Balances: integer-only (lamports), no floating-point
    balanceLamports: bigint("balance_lamports", { mode: "number" })
      .notNull()
      .default(0),
    pendingLamports: bigint("pending_lamports", { mode: "number" })
      .notNull()
      .default(0),

    // =========================================================================
    // BUDGET GUARDRAILS: Trust & Safety controls for autonomous spending
    // =========================================================================
    
    // Max cost per single call (lamports). null = no limit
    maxCostPerCall: bigint("max_cost_per_call", { mode: "number" }),
    
    // Daily spend cap (lamports). null = no limit
    dailySpendCap: bigint("daily_spend_cap", { mode: "number" }),
    
    // Emergency kill switch - immediately stops all outgoing payments
    isPaused: text("is_paused").notNull().default("false"),
    
    // Allowlist of agent IDs this agent can call (JSON array). null = all allowed
    allowedCallees: text("allowed_callees"), // JSON array, e.g., '["agent-1", "agent-2"]'

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  }
);

// =============================================================================
// TOOLS: Per-tool pricing configuration
// =============================================================================
export const tools = pgTable(
  "tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    // Tool identification
    name: text("name").notNull(),
    description: text("description"),

    // Per-tool pricing (overrides agent default)
    ratePer1kTokens: bigint("rate_per_1k_tokens", { mode: "number" }).notNull(),

    // Tool metadata
    isActive: text("is_active").notNull().default("true"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    // Unique constraint: one tool name per agent
    agentToolUnique: uniqueIndex("tools_agent_tool_unique").on(
      table.agentId,
      table.name
    ),
    agentIdIdx: index("tools_agent_id_idx").on(table.agentId),
  })
);

// =============================================================================
// API_KEYS: Authentication
// =============================================================================
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    developerId: text("developer_id").notNull(),
    key: text("key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    keyIdx: index("api_keys_key_idx").on(table.key),
  })
);

// =============================================================================
// PRICING_QUOTES: Time-bound pricing guarantees (prevents race conditions)
// =============================================================================
export const pricingQuotes = pgTable(
  "pricing_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Parties involved
    callerAgentId: text("caller_agent_id").notNull(),
    calleeAgentId: text("callee_agent_id").notNull(),

    // Tool being quoted
    toolId: uuid("tool_id").references(() => tools.id),
    toolName: text("tool_name").notNull(),

    // Token estimate at time of quote
    estimatedTokens: integer("estimated_tokens").notNull(),

    // FROZEN PRICING - captured at quote issuance, immutable
    ratePer1kTokens: bigint("rate_per_1k_tokens", { mode: "number" }).notNull(),
    quotedCostLamports: bigint("quoted_cost_lamports", { mode: "number" }).notNull(),
    platformFeeLamports: bigint("platform_fee_lamports", { mode: "number" }).notNull(),

    // Validity window
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    validityMs: integer("validity_ms").notNull(), // For auditing the TTL used

    // Quote status
    status: text("status").notNull().default("active"), // active | used | expired | cancelled
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedByUsageId: uuid("used_by_usage_id"), // Will be set when quote is consumed

    // Additional context for auditing
    priceSnapshotJson: text("price_snapshot_json"), // Full pricing context as JSON
  },
  (table) => ({
    callerIdx: index("pricing_quotes_caller_idx").on(table.callerAgentId),
    calleeIdx: index("pricing_quotes_callee_idx").on(table.calleeAgentId),
    statusIdx: index("pricing_quotes_status_idx").on(table.status),
    expiresIdx: index("pricing_quotes_expires_idx").on(table.expiresAt),
    issuedAtIdx: index("pricing_quotes_issued_at_idx").on(table.issuedAt),
  })
);

// =============================================================================
// TOOL_USAGE: Immutable execution ledger (append-only, auditable)
// =============================================================================
export const toolUsage = pgTable(
  "tool_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    callerAgentId: text("caller_agent_id").notNull(),
    calleeAgentId: text("callee_agent_id").notNull(),

    // Tool reference (nullable for backward compatibility)
    toolId: uuid("tool_id").references(() => tools.id),
    toolName: text("tool_name").notNull(),
    tokensUsed: integer("tokens_used").notNull(),

    // Price frozen at execution time (prevents retroactive disputes)
    ratePer1kTokens: bigint("rate_per_1k_tokens", { mode: "number" }).notNull(),
    costLamports: bigint("cost_lamports", { mode: "number" }).notNull(),

    // Quote reference for auditability (nullable for backward compatibility)
    quoteId: uuid("quote_id").references(() => pricingQuotes.id),
    quotedAt: timestamp("quoted_at", { withTimezone: true }), // When the price was locked
    quoteExpiresAt: timestamp("quote_expires_at", { withTimezone: true }), // When the quote expired

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    callerIdx: index("tool_usage_caller_idx").on(table.callerAgentId),
    calleeIdx: index("tool_usage_callee_idx").on(table.calleeAgentId),
    createdAtIdx: index("tool_usage_created_at_idx").on(table.createdAt),
    toolIdIdx: index("tool_usage_tool_id_idx").on(table.toolId),
    quoteIdIdx: index("tool_usage_quote_id_idx").on(table.quoteId),
  })
);

// =============================================================================
// SETTLEMENTS: On-chain transaction tracking
// =============================================================================
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    fromAgentId: text("from_agent_id").notNull(),
    toAgentId: text("to_agent_id").notNull(),

    // Amounts in lamports (integer-only)
    grossLamports: bigint("gross_lamports", { mode: "number" }).notNull(),
    platformFeeLamports: bigint("platform_fee_lamports", { mode: "number" }).notNull(),
    netLamports: bigint("net_lamports", { mode: "number" }).notNull(),

    // Solana transaction tracking
    txSignature: text("tx_signature").unique(),
    status: text("status").notNull().default("pending"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    fromAgentIdx: index("settlements_from_agent_idx").on(table.fromAgentId),
    toAgentIdx: index("settlements_to_agent_idx").on(table.toAgentId),
    statusIdx: index("settlements_status_idx").on(table.status),
    createdAtIdx: index("settlements_created_at_idx").on(table.createdAt),
  })
);

// =============================================================================
// PLATFORM_REVENUE: Fee accounting
// =============================================================================
export const platformRevenue = pgTable(
  "platform_revenue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id),
    feeLamports: bigint("fee_lamports", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    settlementIdx: index("platform_revenue_settlement_idx").on(table.settlementId),
    createdAtIdx: index("platform_revenue_created_at_idx").on(table.createdAt),
  })
);

// =============================================================================
// X402_PAYMENTS: HTTP 402 payment tracking
// =============================================================================
export const x402Payments = pgTable(
  "x402_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    txSignature: text("tx_signature").notNull().unique(),
    nonce: text("nonce").notNull().unique(),

    payerWallet: text("payer_wallet").notNull(),
    recipientWallet: text("recipient_wallet").notNull(),

    amountLamports: bigint("amount_lamports", { mode: "number" }).notNull(),

    resourceId: text("resource_id"),
    executionId: uuid("execution_id").references(() => toolUsage.id),

    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    network: text("network").notNull().default("solana-devnet"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    signatureIdx: index("x402_payments_signature_idx").on(table.txSignature),
    nonceIdx: index("x402_payments_nonce_idx").on(table.nonce),
    payerIdx: index("x402_payments_payer_idx").on(table.payerWallet),
    createdAtIdx: index("x402_payments_created_at_idx").on(table.createdAt),
  })
);

// =============================================================================
// RELATIONS: Drizzle relation definitions
// =============================================================================
export const agentsRelations = relations(agents, ({ many }) => ({
  tools: many(tools),
  toolUsageAsCaller: many(toolUsage, { relationName: "caller" }),
  toolUsageAsCallee: many(toolUsage, { relationName: "callee" }),
  // Messaging relations
  conversationsInitiated: many(conversations, { relationName: "conversationsInitiated" }),
  conversationsReceived: many(conversations, { relationName: "conversationsReceived" }),
  messagesSent: many(messages),
  blocking: many(agentBlocks, { relationName: "blocking" }),
  blockedBy: many(agentBlocks, { relationName: "blockedBy" }),
  following: many(agentFollows, { relationName: "following" }),
  followers: many(agentFollows, { relationName: "followers" }),
}));

export const toolsRelations = relations(tools, ({ one, many }) => ({
  agent: one(agents, {
    fields: [tools.agentId],
    references: [agents.id],
  }),
  usages: many(toolUsage),
}));

export const toolUsageRelations = relations(toolUsage, ({ one }) => ({
  caller: one(agents, {
    fields: [toolUsage.callerAgentId],
    references: [agents.id],
    relationName: "caller",
  }),
  callee: one(agents, {
    fields: [toolUsage.calleeAgentId],
    references: [agents.id],
    relationName: "callee",
  }),
  tool: one(tools, {
    fields: [toolUsage.toolId],
    references: [tools.id],
  }),
  quote: one(pricingQuotes, {
    fields: [toolUsage.quoteId],
    references: [pricingQuotes.id],
  }),
}));

export const pricingQuotesRelations = relations(pricingQuotes, ({ one, many }) => ({
  caller: one(agents, {
    fields: [pricingQuotes.callerAgentId],
    references: [agents.id],
    relationName: "quotesAsCaller",
  }),
  callee: one(agents, {
    fields: [pricingQuotes.calleeAgentId],
    references: [agents.id],
    relationName: "quotesAsCallee",
  }),
  tool: one(tools, {
    fields: [pricingQuotes.toolId],
    references: [tools.id],
  }),
  usages: many(toolUsage),
}));

export const settlementsRelations = relations(settlements, ({ many }) => ({
  platformRevenue: many(platformRevenue),
}));

export const platformRevenueRelations = relations(platformRevenue, ({ one }) => ({
  settlement: one(settlements, {
    fields: [platformRevenue.settlementId],
    references: [settlements.id],
  }),
}));

// =============================================================================
// CONVERSATIONS: Consent-based agent-to-agent messaging
// =============================================================================
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Participants
    initiatorAgentId: text("initiator_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    receiverAgentId: text("receiver_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    // Consent workflow: pending → approved | rejected | blocked
    status: text("status").notNull().default("pending"),

    // Initial request message (shown to receiver before approval)
    requestMessage: text("request_message").notNull(),

    // Metadata
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    initiatorUnreadCount: integer("initiator_unread_count").notNull().default(0),
    receiverUnreadCount: integer("receiver_unread_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    // One conversation per agent pair
    agentPairUnique: uniqueIndex("conversations_agent_pair_unique").on(
      table.initiatorAgentId,
      table.receiverAgentId
    ),
    initiatorIdx: index("conversations_initiator_idx").on(table.initiatorAgentId),
    receiverIdx: index("conversations_receiver_idx").on(table.receiverAgentId),
    statusIdx: index("conversations_status_idx").on(table.status),
    lastMessageIdx: index("conversations_last_message_idx").on(table.lastMessageAt),
  })
);

// =============================================================================
// MESSAGES: Private messages within conversations
// =============================================================================
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),

    senderAgentId: text("sender_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    // Message content
    content: text("content").notNull(),

    // Optional: flag for messages that need human review
    needsHumanInput: text("needs_human_input").notNull().default("false"),

    // Read status
    isRead: text("is_read").notNull().default("false"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    conversationIdx: index("messages_conversation_idx").on(table.conversationId),
    senderIdx: index("messages_sender_idx").on(table.senderAgentId),
    createdAtIdx: index("messages_created_at_idx").on(table.createdAt),
  })
);

// =============================================================================
// AGENT_BLOCKS: Track blocked agent pairs
// =============================================================================
export const agentBlocks = pgTable(
  "agent_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    blockerAgentId: text("blocker_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    blockedAgentId: text("blocked_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    blockPairUnique: uniqueIndex("agent_blocks_pair_unique").on(
      table.blockerAgentId,
      table.blockedAgentId
    ),
    blockerIdx: index("agent_blocks_blocker_idx").on(table.blockerAgentId),
    blockedIdx: index("agent_blocks_blocked_idx").on(table.blockedAgentId),
  })
);

// =============================================================================
// AGENT_FOLLOWS: Social following for discovery
// =============================================================================
export const agentFollows = pgTable(
  "agent_follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    followerAgentId: text("follower_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    followingAgentId: text("following_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    followPairUnique: uniqueIndex("agent_follows_pair_unique").on(
      table.followerAgentId,
      table.followingAgentId
    ),
    followerIdx: index("agent_follows_follower_idx").on(table.followerAgentId),
    followingIdx: index("agent_follows_following_idx").on(table.followingAgentId),
  })
);

// =============================================================================
// RELATIONS: Messaging relations
// =============================================================================
export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  initiator: one(agents, {
    fields: [conversations.initiatorAgentId],
    references: [agents.id],
    relationName: "conversationsInitiated",
  }),
  receiver: one(agents, {
    fields: [conversations.receiverAgentId],
    references: [agents.id],
    relationName: "conversationsReceived",
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(agents, {
    fields: [messages.senderAgentId],
    references: [agents.id],
  }),
}));

export const agentBlocksRelations = relations(agentBlocks, ({ one }) => ({
  blocker: one(agents, {
    fields: [agentBlocks.blockerAgentId],
    references: [agents.id],
    relationName: "blocking",
  }),
  blocked: one(agents, {
    fields: [agentBlocks.blockedAgentId],
    references: [agents.id],
    relationName: "blockedBy",
  }),
}));

export const agentFollowsRelations = relations(agentFollows, ({ one }) => ({
  follower: one(agents, {
    fields: [agentFollows.followerAgentId],
    references: [agents.id],
    relationName: "following",
  }),
  following: one(agents, {
    fields: [agentFollows.followingAgentId],
    references: [agents.id],
    relationName: "followers",
  }),
}));

// =============================================================================
// EXECUTION RESULTS: Track success/failure and performance of each call
// =============================================================================
export const executionResults = pgTable(
  "execution_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Link to the tool usage record
    toolUsageId: uuid("tool_usage_id")
      .notNull()
      .references(() => toolUsage.id, { onDelete: "cascade" }),

    // Execution outcome
    status: text("status").notNull(), // 'success' | 'failure' | 'timeout' | 'error'
    
    // Performance metrics (milliseconds)
    latencyMs: integer("latency_ms"),
    
    // Error details (if failed)
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    
    // Recovery information
    retryCount: integer("retry_count").notNull().default(0),
    recoveryAction: text("recovery_action"), // 'none' | 'retry' | 'fallback' | 'refund'
    
    // Refund tracking
    refundIssued: text("refund_issued").notNull().default("false"),
    refundAmountLamports: bigint("refund_amount_lamports", { mode: "number" }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    toolUsageIdx: index("execution_results_tool_usage_idx").on(table.toolUsageId),
    statusIdx: index("execution_results_status_idx").on(table.status),
    createdAtIdx: index("execution_results_created_at_idx").on(table.createdAt),
  })
);

// =============================================================================
// INCIDENTS: Public transparency log for failures and resolutions
// =============================================================================
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Affected agents
    calleeAgentId: text("callee_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    callerAgentId: text("caller_agent_id"),
    
    // Incident classification
    incidentType: text("incident_type").notNull(), // 'timeout' | 'error' | 'degraded' | 'outage' | 'security'
    severity: text("severity").notNull(), // 'low' | 'medium' | 'high' | 'critical'
    
    // Affected scope
    toolName: text("tool_name"),
    affectedCallCount: integer("affected_call_count").notNull().default(1),
    
    // Details
    title: text("title").notNull(),
    description: text("description"),
    rootCause: text("root_cause"),
    
    // Resolution tracking
    status: text("status").notNull().default("open"), // 'open' | 'investigating' | 'resolved' | 'closed'
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNotes: text("resolution_notes"),
    
    // Compensation
    refundsIssued: integer("refunds_issued").notNull().default(0),
    totalRefundLamports: bigint("total_refund_lamports", { mode: "number" }).default(0),
    
    // Timestamps
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    calleeIdx: index("incidents_callee_idx").on(table.calleeAgentId),
    statusIdx: index("incidents_status_idx").on(table.status),
    typeIdx: index("incidents_type_idx").on(table.incidentType),
    createdAtIdx: index("incidents_created_at_idx").on(table.createdAt),
  })
);

// =============================================================================
// AGENT COMPATIBILITY: Tracks successful agent-to-agent integrations
// =============================================================================
export const agentCompatibility = pgTable(
  "agent_compatibility",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Agent pair (caller → callee)
    callerAgentId: text("caller_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    calleeAgentId: text("callee_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    
    // Interaction statistics
    totalCalls: integer("total_calls").notNull().default(0),
    successfulCalls: integer("successful_calls").notNull().default(0),
    failedCalls: integer("failed_calls").notNull().default(0),
    
    // Performance metrics
    avgLatencyMs: integer("avg_latency_ms"),
    p95LatencyMs: integer("p95_latency_ms"),
    
    // Cost metrics
    totalSpentLamports: bigint("total_spent_lamports", { mode: "number" }).default(0),
    avgCostPerCall: bigint("avg_cost_per_call", { mode: "number" }),
    
    // Compatibility score (0-100, auto-calculated)
    compatibilityScore: integer("compatibility_score"),
    
    // Common tools used
    topTools: text("top_tools"), // JSON array of tool names
    
    // Activity tracking
    firstInteraction: timestamp("first_interaction", { withTimezone: true }),
    lastInteraction: timestamp("last_interaction", { withTimezone: true }),
    
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pairUnique: uniqueIndex("agent_compatibility_pair_unique").on(
      table.callerAgentId,
      table.calleeAgentId
    ),
    callerIdx: index("agent_compatibility_caller_idx").on(table.callerAgentId),
    calleeIdx: index("agent_compatibility_callee_idx").on(table.calleeAgentId),
    scoreIdx: index("agent_compatibility_score_idx").on(table.compatibilityScore),
  })
);

// =============================================================================
// RELATIONS: Reputation & Network relations
// =============================================================================
export const executionResultsRelations = relations(executionResults, ({ one }) => ({
  toolUsage: one(toolUsage, {
    fields: [executionResults.toolUsageId],
    references: [toolUsage.id],
  }),
}));

export const incidentsRelations = relations(incidents, ({ one }) => ({
  callee: one(agents, {
    fields: [incidents.calleeAgentId],
    references: [agents.id],
  }),
}));

export const agentCompatibilityRelations = relations(agentCompatibility, ({ one }) => ({
  caller: one(agents, {
    fields: [agentCompatibility.callerAgentId],
    references: [agents.id],
    relationName: "compatibilityAsCaller",
  }),
  callee: one(agents, {
    fields: [agentCompatibility.calleeAgentId],
    references: [agents.id],
    relationName: "compatibilityAsCallee",
  }),
}));

// =============================================================================
// TYPE EXPORTS: TypeScript types for the schema
// =============================================================================
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export type Tool = typeof tools.$inferSelect;
export type NewTool = typeof tools.$inferInsert;

export type ToolUsage = typeof toolUsage.$inferSelect;
export type NewToolUsage = typeof toolUsage.$inferInsert;

export type PricingQuote = typeof pricingQuotes.$inferSelect;
export type NewPricingQuote = typeof pricingQuotes.$inferInsert;

export type Settlement = typeof settlements.$inferSelect;
export type NewSettlement = typeof settlements.$inferInsert;

export type PlatformRevenue = typeof platformRevenue.$inferSelect;
export type NewPlatformRevenue = typeof platformRevenue.$inferInsert;

export type X402Payment = typeof x402Payments.$inferSelect;
export type NewX402Payment = typeof x402Payments.$inferInsert;

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type AgentBlock = typeof agentBlocks.$inferSelect;
export type NewAgentBlock = typeof agentBlocks.$inferInsert;

export type AgentFollow = typeof agentFollows.$inferSelect;
export type NewAgentFollow = typeof agentFollows.$inferInsert;

export type ExecutionResult = typeof executionResults.$inferSelect;
export type NewExecutionResult = typeof executionResults.$inferInsert;

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;

export type AgentCompatibility = typeof agentCompatibility.$inferSelect;
export type NewAgentCompatibility = typeof agentCompatibility.$inferInsert;

// =============================================================================
// WEBHOOKS: Real-time event subscriptions for developers
// =============================================================================
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    
    // Webhook configuration
    url: text("url").notNull(),
    secret: text("secret").notNull(), // For HMAC signature verification
    
    // Event subscriptions (JSON array of event types)
    events: text("events").notNull(), // e.g., '["payment_settled", "spend_limit_reached"]'
    
    // Status and health
    isActive: text("is_active").notNull().default("true"),
    failureCount: integer("failure_count").notNull().default(0),
    lastFailure: timestamp("last_failure", { withTimezone: true }),
    lastSuccess: timestamp("last_success", { withTimezone: true }),
    
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    agentIdx: index("webhooks_agent_idx").on(table.agentId),
    activeIdx: index("webhooks_active_idx").on(table.isActive),
  })
);

// =============================================================================
// WEBHOOK_DELIVERIES: Delivery log for debugging and retry
// =============================================================================
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    
    // Event details
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull(), // JSON payload
    
    // Delivery status
    status: text("status").notNull().default("pending"), // pending, success, failed
    httpStatus: integer("http_status"),
    response: text("response"),
    errorMessage: text("error_message"),
    
    // Timing
    attemptCount: integer("attempt_count").notNull().default(1),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    webhookIdx: index("webhook_deliveries_webhook_idx").on(table.webhookId),
    statusIdx: index("webhook_deliveries_status_idx").on(table.status),
    eventTypeIdx: index("webhook_deliveries_event_type_idx").on(table.eventType),
    createdAtIdx: index("webhook_deliveries_created_at_idx").on(table.createdAt),
  })
);

// =============================================================================
// RELATIONS: Webhook relations
// =============================================================================
export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  agent: one(agents, {
    fields: [webhooks.agentId],
    references: [agents.id],
  }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookDeliveries.webhookId],
    references: [webhooks.id],
  }),
}));

// =============================================================================
// TYPE EXPORTS: Webhook types
// =============================================================================
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;

// =============================================================================
// ANOMALY_ALERTS: Detected suspicious activity
// =============================================================================
export const anomalyAlerts = pgTable(
  "anomaly_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    // Alert classification
    alertType: text("alert_type").notNull(), // token_spike, unusual_caller, pricing_manipulation, settlement_loop
    severity: text("severity").notNull().default("medium"), // low, medium, high, critical

    // Detection details
    description: text("description").notNull(),
    detectedValue: text("detected_value"), // The anomalous value (JSON)
    expectedRange: text("expected_range"), // Expected normal range (JSON)
    confidence: integer("confidence").notNull().default(80), // 0-100

    // Context
    relatedCallerId: text("related_caller_id"),
    relatedToolName: text("related_tool_name"),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),

    // Status
    status: text("status").notNull().default("open"), // open, investigating, resolved, false_positive
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNotes: text("resolution_notes"),

    // Auto-actions taken
    actionsTaken: text("actions_taken"), // JSON array of actions

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    agentIdx: index("anomaly_alerts_agent_idx").on(table.agentId),
    typeIdx: index("anomaly_alerts_type_idx").on(table.alertType),
    severityIdx: index("anomaly_alerts_severity_idx").on(table.severity),
    statusIdx: index("anomaly_alerts_status_idx").on(table.status),
    createdAtIdx: index("anomaly_alerts_created_at_idx").on(table.createdAt),
  })
);

// =============================================================================
// BALANCE_RESERVATIONS: Pre-authorization holds for execution
// =============================================================================
export const balanceReservations = pgTable(
  "balance_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    
    // Parties
    callerAgentId: text("caller_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    calleeAgentId: text("callee_agent_id").notNull(),
    
    // Reservation details
    toolName: text("tool_name").notNull(),
    estimatedTokens: integer("estimated_tokens").notNull(),
    reservedLamports: bigint("reserved_lamports", { mode: "number" }).notNull(),
    
    // Status tracking
    status: text("status").notNull().default("active"), // active, captured, released, expired
    
    // Capture details (filled when captured)
    actualTokens: integer("actual_tokens"),
    actualCostLamports: bigint("actual_cost_lamports", { mode: "number" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    
    // Expiration (reservations auto-expire)
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    callerIdx: index("balance_reservations_caller_idx").on(table.callerAgentId),
    statusIdx: index("balance_reservations_status_idx").on(table.status),
    expiresIdx: index("balance_reservations_expires_idx").on(table.expiresAt),
  })
);

// =============================================================================
// AGENT_BEHAVIOR_STATS: Rolling statistics for anomaly detection
// =============================================================================
export const agentBehaviorStats = pgTable(
  "agent_behavior_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    // Time window
    windowType: text("window_type").notNull(), // hourly, daily, weekly
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),

    // Usage metrics
    totalCalls: integer("total_calls").notNull().default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    totalCostLamports: bigint("total_cost_lamports", { mode: "number" }).notNull().default(0),
    uniqueCallers: integer("unique_callers").notNull().default(0),
    uniqueCallees: integer("unique_callees").notNull().default(0),

    // Pricing metrics
    avgTokensPerCall: integer("avg_tokens_per_call"),
    maxTokensInCall: integer("max_tokens_in_call"),
    avgCostPerCall: bigint("avg_cost_per_call", { mode: "number" }),

    // Settlement metrics
    settlementsAttempted: integer("settlements_attempted").notNull().default(0),
    settlementsFailed: integer("settlements_failed").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    agentWindowUnique: uniqueIndex("agent_behavior_stats_unique").on(
      table.agentId,
      table.windowType,
      table.windowStart
    ),
    agentIdx: index("agent_behavior_stats_agent_idx").on(table.agentId),
    windowIdx: index("agent_behavior_stats_window_idx").on(table.windowType, table.windowStart),
  })
);

// =============================================================================
// RELATIONS: Anti-abuse relations
// =============================================================================
export const anomalyAlertsRelations = relations(anomalyAlerts, ({ one }) => ({
  agent: one(agents, {
    fields: [anomalyAlerts.agentId],
    references: [agents.id],
  }),
}));

export const balanceReservationsRelations = relations(balanceReservations, ({ one }) => ({
  caller: one(agents, {
    fields: [balanceReservations.callerAgentId],
    references: [agents.id],
  }),
}));

export const agentBehaviorStatsRelations = relations(agentBehaviorStats, ({ one }) => ({
  agent: one(agents, {
    fields: [agentBehaviorStats.agentId],
    references: [agents.id],
  }),
}));

// =============================================================================
// TYPE EXPORTS: Anti-abuse types
// =============================================================================
export type AnomalyAlert = typeof anomalyAlerts.$inferSelect;
export type NewAnomalyAlert = typeof anomalyAlerts.$inferInsert;

export type BalanceReservation = typeof balanceReservations.$inferSelect;
export type NewBalanceReservation = typeof balanceReservations.$inferInsert;

export type AgentBehaviorStats = typeof agentBehaviorStats.$inferSelect;
export type NewAgentBehaviorStats = typeof agentBehaviorStats.$inferInsert;
