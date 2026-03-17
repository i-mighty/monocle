/**
 * Conversations Module
 * 
 * Handles conversation history, retrieval, and management.
 */

import type { RequestFn, Pagination } from "./base";

// =============================================================================
// TYPES
// =============================================================================

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  tokens?: number;
  cost?: { lamports: number; usd: number };
}

export interface Conversation {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  totalTokens: number;
  totalCost: { lamports: number; usd: number };
  lastMessage?: {
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  };
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface ConversationStats {
  totalConversations: number;
  totalMessages: number;
  totalTokens: number;
  totalCost: { lamports: number; usd: number };
  avgMessagesPerConversation: number;
  topTaskTypes: Array<{ type: string; count: number }>;
}

// =============================================================================
// CONVERSATIONS MODULE
// =============================================================================

export class ConversationsModule {
  constructor(private request: RequestFn) {}

  /**
   * List all conversations.
   * 
   * Returns a paginated list of conversations, most recent first.
   * 
   * @example
   * ```typescript
   * const { conversations } = await client.conversations.list();
   * for (const conv of conversations) {
   *   console.log(`${conv.id}: ${conv.messageCount} messages`);
   * }
   * ```
   */
  async list(options?: { limit?: number; offset?: number }): Promise<{
    conversations: Conversation[];
    pagination: Pagination;
  }> {
    const params = new URLSearchParams();
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.offset) params.append("offset", options.offset.toString());
    const query = params.toString() ? `?${params.toString()}` : "";

    return this.request(`/chat/history${query}`, { method: "GET" });
  }

  /**
   * Get a specific conversation with all messages.
   * 
   * @example
   * ```typescript
   * const conversation = await client.conversations.get("conv-123");
   * for (const msg of conversation.messages) {
   *   console.log(`${msg.role}: ${msg.content}`);
   * }
   * ```
   */
  async get(conversationId: string): Promise<ConversationDetail> {
    return this.request(`/chat/conversations/${conversationId}`, { method: "GET" });
  }

  /**
   * Delete a conversation and all its messages.
   * 
   * @example
   * ```typescript
   * await client.conversations.delete("conv-123");
   * ```
   */
  async delete(conversationId: string): Promise<{ success: boolean }> {
    return this.request(`/chat/conversations/${conversationId}`, { method: "DELETE" });
  }

  /**
   * Get conversation statistics.
   * 
   * @example
   * ```typescript
   * const stats = await client.conversations.stats();
   * console.log(`Total conversations: ${stats.totalConversations}`);
   * console.log(`Total tokens used: ${stats.totalTokens}`);
   * ```
   */
  async stats(): Promise<ConversationStats> {
    return this.request("/chat/stats", { method: "GET" });
  }

  /**
   * Search conversations by content.
   * 
   * @example
   * ```typescript
   * const results = await client.conversations.search("neural networks");
   * ```
   */
  async search(query: string, options?: { limit?: number }): Promise<{
    conversations: Conversation[];
  }> {
    const params = new URLSearchParams();
    params.append("q", query);
    if (options?.limit) params.append("limit", options.limit.toString());

    return this.request(`/chat/search?${params.toString()}`, { method: "GET" });
  }

  /**
   * Rename a conversation.
   * 
   * @example
   * ```typescript
   * await client.conversations.rename("conv-123", "AI Discussion");
   * ```
   */
  async rename(conversationId: string, title: string): Promise<{ success: boolean }> {
    return this.request(`/chat/conversations/${conversationId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }

  /**
   * Export a conversation.
   * 
   * Returns the conversation in a format suitable for backup or sharing.
   * 
   * @example
   * ```typescript
   * const exported = await client.conversations.export("conv-123", "markdown");
   * fs.writeFileSync("conversation.md", exported.content);
   * ```
   */
  async export(conversationId: string, format: "json" | "markdown" = "json"): Promise<{
    content: string;
    format: string;
  }> {
    return this.request(`/chat/conversations/${conversationId}/export?format=${format}`, {
      method: "GET",
    });
  }
}
