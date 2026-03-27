// =============================================================================
// SPECIALIST AGENT SERVICE: Execute AI Requests
// =============================================================================
// Handles execution of requests through different AI providers:
// - OpenAI (GPT-4, DALL-E)
// - Anthropic (Claude)
// - Google (Gemini)
//
// Integrates with AgentPay for metering and payment.
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
// SIMULATED RESPONSES (FOR DEMO WITHOUT API KEYS)
// =============================================================================

function simulateResponse(
  provider: string,
  model: string,
  messages: ConversationMessage[]
): ExecutionResult {
  const lastMessage = messages[messages.length - 1];
  const query = lastMessage?.content || "";
  
  // Simulate processing time
  const latencyMs = 500 + Math.random() * 1500;
  
  // Estimate tokens
  const inputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  
  // Generate contextual demo response
  let response = generateDemoResponse(query, provider, model);
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

function generateDemoResponse(query: string, provider: string, model: string): string {
  const lowerQuery = query.toLowerCase();
  
  // Task-specific demo responses
  if (lowerQuery.includes("code") || lowerQuery.includes("function") || lowerQuery.includes("program")) {
    return `Here's a solution using ${model}:

\`\`\`javascript
// Example implementation
function processData(input) {
  // Validate input
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid input');
  }
  
  // Process the data
  const result = Object.entries(input)
    .filter(([key, value]) => value !== null)
    .map(([key, value]) => ({ key, value: String(value) }));
  
  return result;
}

// Usage
const output = processData({ name: "test", value: 42 });
console.log(output);
\`\`\`

This implementation handles edge cases and provides type safety. Let me know if you need modifications!`;
  }
  
  if (lowerQuery.includes("research") || lowerQuery.includes("what is") || lowerQuery.includes("explain")) {
    return `Based on my analysis using ${model}:

**Key Points:**

1. **Overview**: The topic you're asking about is an important area with significant implications across multiple domains.

2. **Core Concepts**: At its foundation, this involves understanding the relationships between different components and how they interact.

3. **Practical Applications**: This knowledge can be applied in various contexts including technology, business, and research.

4. **Current Developments**: Recent advancements have expanded our understanding and opened new possibilities.

**Summary**: This is a nuanced topic that benefits from deeper exploration. Would you like me to elaborate on any specific aspect?

*Powered by AgentPay - ${provider}/${model}*`;
  }
  
  if (lowerQuery.includes("image") || lowerQuery.includes("picture") || lowerQuery.includes("generate")) {
    return `I understand you want to generate an image. Here's what I would create:

**Image Description:**
A detailed, high-quality image based on your prompt. The composition would include:
- Primary subject centered with good framing
- Appropriate lighting and atmosphere
- Professional artistic style

*Note: Actual image generation requires DALL-E API key. In production, this would return an image URL.*

**Estimated cost:** ~50,000 lamports for high-quality generation

Would you like to proceed with image generation once API keys are configured?`;
  }
  
  if (lowerQuery.includes("translate")) {
    return `**Translation Result** (via ${model}):

I can help translate your text between languages. Please provide:
1. The text you want translated
2. The target language

I support translations between:
- English, Spanish, French, German
- Chinese, Japanese, Korean
- Portuguese, Italian, Russian
- And many more...

*Fast and accurate translation powered by AgentPay*`;
  }
  
  // Default conversational response
  return `Thank you for your question! I'm ${model}, powered by ${provider} through AgentPay's AI orchestration.

Here's my response:

${query.length > 50 ? "Based on your detailed query, " : ""}I can help you with this. The AgentPay system automatically routed your request to me as the best-suited agent for this type of question.

**What I can help with:**
- Answering questions and providing analysis
- Code generation and debugging
- Research and information synthesis
- Creative writing and content
- Mathematical calculations

**How AgentPay works:**
1. Your request is classified automatically
2. The best specialist agent is selected
3. I process your request
4. Usage is metered and payment is handled seamlessly

Is there anything specific you'd like me to help you with?

*Response generated by AgentPay AI Router - pay only for what you use*`;
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
  const basePrompt = `You are ${agent.name}, a specialized AI assistant powered by AgentPay.`;
  
  const taskPrompts: Record<TaskType, string> = {
    research: `${basePrompt} You excel at research, fact-finding, and providing accurate, well-sourced information. Be thorough but concise.`,
    image: `${basePrompt} You help users create and describe images. Provide detailed descriptions and guidance for image generation.`,
    code: `${basePrompt} You are an expert programmer. Write clean, well-documented code. Explain your solutions clearly.`,
    reasoning: `${basePrompt} You provide thoughtful analysis and balanced perspectives. Help users think through problems.`,
    writing: `${basePrompt} You are a skilled writer. Help users craft compelling content with proper structure and style.`,
    math: `${basePrompt} You excel at mathematics. Show your work step-by-step and verify calculations.`,
    translation: `${basePrompt} You are a precise translator. Maintain meaning, tone, and cultural nuances in translations.`,
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
