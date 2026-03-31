// =============================================================================
// SPECIALIST AGENT SERVICE: Execute AI Requests
// =============================================================================
// Handles execution of requests through different AI providers:
// - Groq (Llama 3.3 70B — free tier, fast)
// - OpenAI (GPT-4, DALL-E)
// - Anthropic (Claude)
// - Google (Gemini)
//
// Integrates with Monocle for metering and payment.
// Includes escrow-based payment protection.
// =============================================================================

import { query } from "../db/client";
import { SpecialistAgent, RoutingDecision, ChatResponse, TaskType } from "./routerService";
import { createEscrowHold, releaseEscrowHold, refundEscrowHold } from "./escrowService";

// =============================================================================
// TYPES
// =============================================================================

interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ExecutionResult {
  success: boolean;
  response: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  error?: string;
}

interface Conversation {
  id: string;
  userId: string;
  messages: ConversationMessage[];
  totalTokens: number;
  totalCostLamports: number;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// CONVERSATION TOKEN MANAGEMENT
// =============================================================================

const TOKEN_LIMITS = {
  /** Maximum tokens allowed in conversation context */
  MAX_CONTEXT_TOKENS: 16000,
  
  /** Reserve for response generation */
  RESPONSE_RESERVE: 2048,
  
  /** Minimum messages to keep (recent context) */
  MIN_MESSAGES_TO_KEEP: 4,
  
  /** Approximate chars per token (rough estimate) */
  CHARS_PER_TOKEN: 4
} as const;

/**
 * Estimate token count for a message (fast approximation)
 * For production, use tiktoken or similar for accurate counts
 */
function estimateTokens(text: string): number {
  // Simple estimation: ~4 chars per token on average for English
  // This is a reasonable approximation for most use cases
  return Math.ceil(text.length / TOKEN_LIMITS.CHARS_PER_TOKEN);
}

/**
 * Count total tokens in a conversation
 */
function countConversationTokens(messages: ConversationMessage[]): number {
  return messages.reduce((sum, msg) => {
    // Add overhead for message structure (~4 tokens per message)
    return sum + estimateTokens(msg.content) + 4;
  }, 0);
}

/**
 * Truncate conversation history to fit within token limits
 * 
 * Strategy:
 * 1. Keep system messages (if any)
 * 2. Keep the most recent N messages (MIN_MESSAGES_TO_KEEP)
 * 3. Remove oldest messages until under limit
 * 4. Add truncation notice if messages were removed
 */
function truncateConversation(
  messages: ConversationMessage[],
  maxTokens: number = TOKEN_LIMITS.MAX_CONTEXT_TOKENS - TOKEN_LIMITS.RESPONSE_RESERVE
): { messages: ConversationMessage[]; truncated: boolean; removedCount: number } {
  
  const currentTokens = countConversationTokens(messages);
  
  if (currentTokens <= maxTokens) {
    return { messages, truncated: false, removedCount: 0 };
  }

  // Separate system messages from conversation
  const systemMessages = messages.filter(m => m.role === "system");
  const conversationMessages = messages.filter(m => m.role !== "system");
  
  // Calculate system tokens
  const systemTokens = countConversationTokens(systemMessages);
  const availableForConversation = maxTokens - systemTokens;

  // Keep removing oldest messages until we fit
  let truncatedConversation = [...conversationMessages];
  let removedCount = 0;
  
  while (
    truncatedConversation.length > TOKEN_LIMITS.MIN_MESSAGES_TO_KEEP &&
    countConversationTokens(truncatedConversation) > availableForConversation
  ) {
    // Remove oldest message pair (user + assistant typically)
    truncatedConversation.shift();
    removedCount++;
  }

  // Add truncation notice if messages were removed
  if (removedCount > 0) {
    const notice: ConversationMessage = {
      role: "system",
      content: `[Note: ${removedCount} earlier messages were removed to fit context window. The conversation continues from here.]`
    };
    truncatedConversation = [notice, ...truncatedConversation];
  }

  // Recombine with system messages
  const result = [...systemMessages, ...truncatedConversation];
  
  console.log(`[Context] Truncated conversation: removed ${removedCount} messages, ${countConversationTokens(result)} tokens remaining`);
  
  return {
    messages: result,
    truncated: removedCount > 0,
    removedCount
  };
}

// =============================================================================
// PROVIDER CLIENTS (Simulated for now - replace with real SDKs)
// =============================================================================

// In production, these would use actual SDK clients:
// import OpenAI from 'openai';
// import Anthropic from '@anthropic-ai/sdk';

const PROVIDER_CONFIGS = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY"
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY"
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY"
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1",
    apiKeyEnv: "GOOGLE_API_KEY"
  }
};

// =============================================================================
// AI PROVIDER EXECUTION
// =============================================================================

async function executeGroq(
  model: string,
  messages: ConversationMessage[],
  systemPrompt?: string
): Promise<ExecutionResult> {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return simulateResponse("groq", model, messages);
  }

  try {
    const startTime = Date.now();

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          ...messages
        ],
        max_tokens: 2048
      })
    });

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      throw new Error(data.error?.message || `Groq API error ${response.status}`);
    }

    return {
      success: true,
      response: data.choices[0].message.content,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      },
      latencyMs
    };
  } catch (error: any) {
    return {
      success: false,
      response: "",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      error: error.message
    };
  }
}

async function executeOpenAI(
  model: string,
  messages: ConversationMessage[],
  systemPrompt?: string
): Promise<ExecutionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    // Return simulated response for demo
    return simulateResponse("openai", model, messages);
  }

  try {
    const startTime = Date.now();
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          ...messages
        ],
        max_tokens: 2048
      })
    });

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      throw new Error(data.error?.message || "OpenAI API error");
    }

    return {
      success: true,
      response: data.choices[0].message.content,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      },
      latencyMs
    };
  } catch (error: any) {
    return {
      success: false,
      response: "",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      error: error.message
    };
  }
}

async function executeAnthropic(
  model: string,
  messages: ConversationMessage[],
  systemPrompt?: string
): Promise<ExecutionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    return simulateResponse("anthropic", model, messages);
  }

  try {
    const startTime = Date.now();
    
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.filter(m => m.role !== "system")
      })
    });

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      throw new Error(data.error?.message || "Anthropic API error");
    }

    return {
      success: true,
      response: data.content[0].text,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens
      },
      latencyMs
    };
  } catch (error: any) {
    return {
      success: false,
      response: "",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      error: error.message
    };
  }
}

async function executeGoogle(
  model: string,
  messages: ConversationMessage[],
  systemPrompt?: string
): Promise<ExecutionResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  
  if (!apiKey) {
    return simulateResponse("google", model, messages);
  }

  try {
    const startTime = Date.now();
    
    // Convert messages to Gemini format
    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    // Build request body
    const requestBody: any = { contents };
    
    // Use v1beta endpoint which supports newer models and systemInstruction
    const apiVersion = "v1beta";
    
    if (systemPrompt) {
      requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      throw new Error(data.error?.message || "Google API error");
    }

    // Estimate tokens (Gemini doesn't always return usage)
    const responseText = data.candidates[0].content.parts[0].text;
    const inputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    const outputTokens = Math.ceil(responseText.length / 4);

    return {
      success: true,
      response: responseText,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      latencyMs
    };
  } catch (error: any) {
    return {
      success: false,
      response: "",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      error: error.message
    };
  }
}

// =============================================================================
// SIMULATED RESPONSES (FALLBACK WHEN NO API KEYS ARE CONFIGURED)
// =============================================================================

function simulateResponse(
  provider: string,
  model: string,
  messages: ConversationMessage[]
): ExecutionResult {
  const lastMessage = messages[messages.length - 1];
  const query = lastMessage?.content || "";
  
  const latencyMs = 300 + Math.random() * 700;
  const inputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  
  let response = generateDemoResponse(query);
  const outputTokens = Math.ceil(response.length / 4);

  return {
    success: true,
    response,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    },
    latencyMs: Math.round(latencyMs)
  };
}

function generateDemoResponse(query: string): string {
  const q = query.toLowerCase();
  
  if (q.includes("code") || q.includes("function") || q.includes("program") || q.includes("implement")) {
    return `Here's an implementation:

\`\`\`javascript
function processData(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid input');
  }
  
  return Object.entries(input)
    .filter(([_, value]) => value !== null)
    .map(([key, value]) => ({ key, value: String(value) }));
}

const output = processData({ name: "test", value: 42 });
console.log(output);
\`\`\`

This handles null filtering and type coercion. Want me to adapt it for your specific use case?`;
  }
  
  if (q.includes("what is") || q.includes("explain") || q.includes("how does")) {
    const topic = query.replace(/^(what is|explain|how does)\s*/i, "").replace(/\?$/, "").trim() || "that";
    return `**${topic.charAt(0).toUpperCase() + topic.slice(1)}**

This is a broad topic — here are the key points:

1. **Core concept** — At its foundation, ${topic} involves understanding how components interact within a larger system.
2. **Why it matters** — It has significant practical applications in technology, research, and engineering.
3. **Current state** — Recent developments have expanded what's possible considerably.

Would you like me to go deeper on any specific aspect?`;
  }

  if (q.includes("translate")) {
    return `I can translate between most major languages — English, Spanish, French, German, Chinese, Japanese, Korean, Portuguese, Italian, Russian, and more.

Please provide:\n1. The text you want translated\n2. The target language\n\nI'll preserve meaning, tone, and cultural nuance.`;
  }

  if (q.includes("image") || q.includes("picture") || q.includes("draw") || q.includes("generate")) {
    return `I can describe an image composition for you:

**Suggested composition:**
- Primary subject centered with balanced framing
- Soft directional lighting for depth
- Clean, professional style

*Note: Real image generation requires a DALL-E API key. Once configured, this will return an actual generated image.*`;
  }

  if (q.includes("math") || q.includes("calculate") || q.includes("solve") || /\d+\s*[\+\-\*\/]/.test(q)) {
    return `I'd be happy to help with the math. Could you provide the specific equation or problem? I'll show my work step-by-step so you can follow the reasoning.`;
  }

  // Default: echo back the user's intent naturally
  if (query.length > 20) {
    return `That's a good question. Let me break it down:\n\n${query.length > 100
      ? "Based on what you've described, there are a few angles to consider here. "
      : ""}The short answer is that this depends on your specific context and requirements. Here's what I'd recommend:\n\n1. **Start with the fundamentals** — make sure you have the core concepts clear before adding complexity.\n2. **Iterate** — try the simplest approach first, then refine based on results.\n3. **Test your assumptions** — what works in theory doesn't always hold in practice.\n\nWant me to drill into any of these in more detail?`;
  }

  return `Hello! I'm ready to help. You can ask me about:\n\n- **Code** — generation, debugging, architecture\n- **Research** — analysis, fact-finding, synthesis\n- **Writing** — drafting, editing, style improvement\n- **Math** — calculations, step-by-step solutions\n- **Translation** — between 20+ languages\n\nWhat would you like to work on?`;
}

// =============================================================================
// MAIN EXECUTION FUNCTION
// =============================================================================

export async function executeSpecialistRequest(
  agent: SpecialistAgent,
  messages: ConversationMessage[],
  taskType: TaskType
): Promise<ExecutionResult> {
  // Build system prompt based on task type
  const systemPrompt = buildSystemPrompt(agent, taskType);

  // Route to appropriate provider
  switch (agent.provider) {
    case "groq":
      return executeGroq(agent.model, messages, systemPrompt);
    case "openai":
      return executeOpenAI(agent.model, messages, systemPrompt);
    case "anthropic":
      return executeAnthropic(agent.model, messages, systemPrompt);
    case "google":
      return executeGoogle(agent.model, messages, systemPrompt);
    default:
      // Fallback to simulation for unknown providers
      return simulateResponse(agent.provider, agent.model, messages);
  }
}

function buildSystemPrompt(agent: SpecialistAgent, taskType: TaskType): string {
  const basePrompt = `You are Monocle, an AI agent marketplace that automatically routes requests to the best specialist agent. You are currently powered by the ${agent.name} specialist. When asked to introduce yourself, say you are Monocle — an intelligent AI router that connects users to the best AI agent for any task. Mention you can help with: code generation & debugging, research & analysis, creative writing, math & reasoning, translation, and image generation. You settle payments on Solana using the x402 protocol. Be helpful, concise, and conversational. Never say you are a "language model" — you are Monocle.`;
  
  const taskPrompts: Record<TaskType, string> = {
    research: `${basePrompt} For this task, lean into research skills: fact-finding, synthesis, and well-sourced information.`,
    image: `${basePrompt} For this task, help with image creation: detailed descriptions and guidance for image generation.`,
    code: `${basePrompt} For this task, be an expert programmer: clean code, clear explanations, best practices.`,
    reasoning: `${basePrompt} For this task, provide thoughtful analysis and balanced perspectives.`,
    writing: `${basePrompt} For this task, craft compelling content with proper structure and style.`,
    math: `${basePrompt} For this task, show work step-by-step and verify calculations.`,
    translation: `${basePrompt} For this task, translate precisely while maintaining meaning, tone, and cultural nuance.`,
    unknown: basePrompt
  };

  return taskPrompts[taskType] || basePrompt;
}

// =============================================================================
// CONVERSATION MANAGEMENT
// =============================================================================

export async function getOrCreateConversation(
  userId: string,
  conversationId?: string
): Promise<Conversation> {
  if (conversationId) {
    // Try to load existing conversation
    const result = await query(`
      SELECT * FROM conversations_ai WHERE id = $1 AND user_id = $2
    `, [conversationId, userId]);

    if (result.rows[0]) {
      return {
        id: result.rows[0].id,
        userId: result.rows[0].user_id,
        messages: JSON.parse(result.rows[0].messages || "[]"),
        totalTokens: result.rows[0].total_tokens || 0,
        totalCostLamports: result.rows[0].total_cost_lamports || 0,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at
      };
    }
  }

  // Create new conversation
  const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    await query(`
      INSERT INTO conversations_ai (id, user_id, messages, total_tokens, total_cost_lamports)
      VALUES ($1, $2, '[]', 0, 0)
    `, [id, userId]);
  } catch (error) {
    // Table might not exist yet, that's ok for demo
    console.log("Conversation tracking not available (table may not exist)");
  }

  return {
    id,
    userId,
    messages: [],
    totalTokens: 0,
    totalCostLamports: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

export async function updateConversation(
  conversation: Conversation,
  userMessage: string,
  assistantResponse: string,
  tokensUsed: number,
  costLamports: number
): Promise<void> {
  conversation.messages.push(
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantResponse }
  );
  conversation.totalTokens += tokensUsed;
  conversation.totalCostLamports += costLamports;

  try {
    await query(`
      UPDATE conversations_ai
      SET messages = $1, total_tokens = $2, total_cost_lamports = $3, updated_at = NOW()
      WHERE id = $4
    `, [
      JSON.stringify(conversation.messages),
      conversation.totalTokens,
      conversation.totalCostLamports,
      conversation.id
    ]);
  } catch (error) {
    // Silently fail if table doesn't exist
  }
}

// =============================================================================
// COST CALCULATION
// =============================================================================

export function calculateCost(
  agent: SpecialistAgent,
  tokensUsed: number
): { agentCost: number; platformFee: number; totalCost: number } {
  // Enforce MIN_COST to prevent spam (spec requirement)
  const tokenBlocks = Math.ceil(tokensUsed / 1000);
  const agentCost = Math.max(tokenBlocks * agent.ratePer1kTokens, 100); // MIN_COST = 100 lamports
  
  // Platform fee (5%)
  const platformFee = Math.ceil(agentCost * 0.05);
  
  return {
    agentCost,
    platformFee,
    totalCost: agentCost + platformFee
  };
}

// =============================================================================
// FULL CHAT EXECUTION (WITH RETRY/FALLBACK + ESCROW)
// =============================================================================

interface ExecuteChatOptions {
  conversationId?: string;
  useEscrow?: boolean;       // Enable escrow-protected payments
  estimatedTokens?: number;  // For escrow estimation (default: 2000)
}

export async function executeChat(
  userId: string,
  message: string,
  routingDecision: RoutingDecision,
  options: ExecuteChatOptions = {}
): Promise<ChatResponse> {
  const startTime = Date.now();
  const { conversationId, useEscrow = true, estimatedTokens = 2000 } = options;

  // Enforce MAX_TOKENS cap per call (anti-abuse)
  const MAX_TOKENS_PER_CALL = 100_000;
  if (estimatedTokens > MAX_TOKENS_PER_CALL) {
    throw new Error(`Token estimate ${estimatedTokens} exceeds maximum ${MAX_TOKENS_PER_CALL} per call`);
  }

  // Get or create conversation
  const conversation = await getOrCreateConversation(userId, conversationId);

  // Build messages array with history
  let messages: ConversationMessage[] = [
    ...conversation.messages,
    { role: "user", content: message }
  ];

  // ============= TOKEN MANAGEMENT: Truncate if needed =============
  const truncationResult = truncateConversation(messages);
  messages = truncationResult.messages;
  
  if (truncationResult.truncated) {
    console.log(`[Context] Conversation truncated: ${truncationResult.removedCount} messages removed`);
  }

  // ============= ESCROW: Create hold before execution =============
  let holdId: string | undefined;
  
  if (useEscrow) {
    const holdResult = await createEscrowHold({
      userId,
      agentId: routingDecision.selectedAgent.agentId,
      estimatedTokens,
      ratePer1kTokens: routingDecision.selectedAgent.ratePer1kTokens,
      toolName: "chat"
    });

    if (!holdResult.success) {
      throw new Error(`Payment hold failed: ${holdResult.error}`);
    }
    
    holdId = holdResult.hold!.holdId;
    console.log(`[Escrow] Hold created: ${holdId} for ${holdResult.hold!.holdAmountLamports} lamports`);
  }

  // Build list of agents to try: primary + alternatives
  const agentsToTry = [
    routingDecision.selectedAgent,
    ...(routingDecision.alternativeAgents || [])
  ];

  let result: ExecutionResult | null = null;
  let usedAgent = routingDecision.selectedAgent;
  const failedAgents: string[] = [];

  try {
    // Try each agent in order until one succeeds
    for (const agent of agentsToTry) {
      console.log(`[Specialist] Trying agent: ${agent.name} (${agent.model})`);
      
      const attemptResult = await executeSpecialistRequest(
        agent,
        messages,
        routingDecision.taskType
      );

      if (attemptResult.success) {
        result = attemptResult;
        usedAgent = agent;
        
        if (failedAgents.length > 0) {
          console.log(`[Specialist] Success with fallback agent: ${agent.name} after ${failedAgents.length} failures`);
        }
        break;
      }

      // Log the failure and try next agent
      failedAgents.push(`${agent.name}: ${attemptResult.error}`);
      console.log(`[Specialist] Agent ${agent.name} failed: ${attemptResult.error}`);
    }

    // If all agents failed, refund escrow and throw error
    if (!result || !result.success) {
      if (holdId) {
        await refundEscrowHold(holdId, "All agents failed");
        console.log(`[Escrow] Refunded hold ${holdId} due to execution failure`);
      }
      const errorDetails = failedAgents.join("; ");
      throw new Error(`All agents failed. Attempted: ${errorDetails}`);
    }

    // ============= ESCROW: Release hold on success =============
    let escrowRelease: { actualCost: number; refundAmount: number } | undefined;
    
    if (holdId) {
      const releaseResult = await releaseEscrowHold(
        holdId,
        result.usage.totalTokens,
        usedAgent.ratePer1kTokens
      );
      
      if (releaseResult.success) {
        escrowRelease = {
          actualCost: releaseResult.actualCost,
          refundAmount: releaseResult.refundAmount
        };
        console.log(`[Escrow] Released: ${releaseResult.actualCost} to agent, ${releaseResult.refundAmount} refunded`);
      }
    }

    // Calculate cost (for response, escrow handles actual payment)
    const cost = calculateCost(usedAgent, result.usage.totalTokens);

    // Update conversation
    await updateConversation(
      conversation,
      message,
      result.response,
      result.usage.totalTokens,
      cost.totalCost
    );

    // Build response
    const response: ChatResponse = {
      conversationId: conversation.id,
      messageId: `msg-${Date.now()}`,
      response: result.response,
      taskType: routingDecision.taskType,
      agentUsed: {
        agentId: usedAgent.agentId,
        name: usedAgent.name,
        model: usedAgent.model
      },
      usage: result.usage,
      cost: {
        totalLamports: cost.totalCost,
        breakdown: {
          agentCost: cost.agentCost,
          platformFee: cost.platformFee
        }
      },
      latencyMs: Date.now() - startTime,
      // Include fallback info if we used an alternative
      ...(failedAgents.length > 0 && {
        fallbackUsed: true,
        failedAgents: failedAgents.length
      })
    };

    return response;
    
  } catch (error) {
    // If anything fails after creating hold, ensure refund
    if (holdId) {
      await refundEscrowHold(holdId, `Execution error: ${(error as Error).message}`);
      console.log(`[Escrow] Emergency refund for hold ${holdId}`);
    }
    throw error;
  }
}
