// =============================================================================
// ORCHESTRATOR SERVICE: Multi-Agent Task Decomposition & Execution
// =============================================================================
// Detects complex multi-step queries, decomposes them into sub-tasks,
// dispatches each to a specialist agent with real Solana payments,
// and streams the entire chain to the frontend in real time.
//
// This is Monocle's killer feature: agents autonomously delegating
// and paying each other on Solana via x402.
// =============================================================================

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TaskType } from "./routerService";
import { executeSpecialistRequest, ConversationMessage } from "./specialistService";
import {
  createDelegationContext,
  validateDelegation,
  recordDelegationComplete,
  DelegationContext,
} from "./delegationGuardian";

// =============================================================================
// TYPES
// =============================================================================

export interface SubTask {
  id: string;
  type: TaskType;
  description: string;        // What the sub-agent should do
  inputContext?: string;       // Output from a previous agent (chaining)
  agentId: string;
  agentName: string;
  model: string;
  provider: string;
  ratePer1kTokens: number;
}

export interface OrchestrationPlan {
  chainId: string;
  originalQuery: string;
  tasks: SubTask[];
  totalEstimatedCostLamports: number;
}

export interface AgentResult {
  taskId: string;
  agentName: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  costLamports: number;
  latencyMs: number;
  txSignature: string | null;
}

export type OrchestrationEvent =
  | { type: "orchestration_start"; plan: OrchestrationPlan }
  | { type: "agent_start"; taskId: string; taskIndex: number; totalTasks: number; agent: { id: string; name: string; model: string; provider: string }; description: string; estimatedCostLamports: number }
  | { type: "agent_chunk"; taskId: string; text: string; accumulated: string }
  | { type: "agent_complete"; taskId: string; agentName: string; costLamports: number; txSignature: string | null; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; latencyMs: number }
  | { type: "orchestration_complete"; totalCostLamports: number; totalLatencyMs: number; agentCount: number; chainId: string; results: AgentResult[] };

// =============================================================================
// AGENT REGISTRY (specialist agents for orchestration)
// =============================================================================

const ORCHESTRATION_AGENTS: Record<string, Omit<SubTask, "id" | "description" | "inputContext">> = {
  research: {
    type: "research",
    agentId: "orch-research-001",
    agentName: "Research Agent",
    model: "llama-3.3-70b-versatile",
    provider: "groq",
    ratePer1kTokens: 75,
  },
  writer: {
    type: "writing",
    agentId: "orch-writer-001",
    agentName: "Writer Agent",
    model: "llama-3.3-70b-versatile",
    provider: "groq",
    ratePer1kTokens: 120,
  },
  coder: {
    type: "code",
    agentId: "orch-coder-001",
    agentName: "Code Agent",
    model: "llama-3.3-70b-versatile",
    provider: "groq",
    ratePer1kTokens: 200,
  },
  formatter: {
    type: "writing",
    agentId: "orch-formatter-001",
    agentName: "Formatter Agent",
    model: "llama-3.3-70b-versatile",
    provider: "groq",
    ratePer1kTokens: 50,
  },
  analyst: {
    type: "reasoning",
    agentId: "orch-analyst-001",
    agentName: "Analyst Agent",
    model: "llama-3.3-70b-versatile",
    provider: "groq",
    ratePer1kTokens: 150,
  },
  translator: {
    type: "translation",
    agentId: "orch-translator-001",
    agentName: "Translator Agent",
    model: "llama-3.3-70b-versatile",
    provider: "groq",
    ratePer1kTokens: 75,
  },
};

// =============================================================================
// MULTI-STEP DETECTION
// =============================================================================

const MULTI_STEP_PATTERNS = [
  // Explicit multi-step: "research X, write Y, and format Z"
  /\b(?:research|find|look up|search)\b.+\b(?:write|create|draft|compose)\b.+\b(?:format|style|convert|output)\b/i,
  // Two-step with connectors: "research X and write Y"
  /\b(?:research|find|analyze|compare)\b.+\b(?:then|and then|after that|next|,\s*(?:then\s+)?(?:write|create|summarize|format|translate|code))\b/i,
  // Explicit ordering: "first... then... finally"
  /\bfirst\b.+\bthen\b.+\b(?:finally|lastly|after that)\b/i,
  // Step-based: "step 1... step 2..."
  /\bstep\s*1\b.+\bstep\s*2\b/i,
  // List of actions: "1. research 2. write 3. format"
  /\b1[\.\)]\s*\w+.+\b2[\.\)]\s*\w+/i,
  // Compare and report pattern
  /\bcompare\b.+\b(?:report|summary|write[\s-]?up|document)\b/i,
  // Research and create pattern
  /\b(?:research|investigate|find out)\b.+\b(?:create|build|make|write|generate)\b/i,
];

/**
 * Detect whether a query should trigger multi-agent orchestration
 */
export function needsOrchestration(query: string): boolean {
  if (query.length < 40) return false; // Short queries are single-task
  return MULTI_STEP_PATTERNS.some((p) => p.test(query));
}

// =============================================================================
// TASK DECOMPOSITION (via LLM)
// =============================================================================

/**
 * Use Groq to decompose a complex query into ordered sub-tasks.
 * Falls back to heuristic decomposition if API is unavailable.
 */
export async function decomposeTask(query: string): Promise<SubTask[]> {
  const apiKey = process.env.GROQ_API_KEY;

  if (apiKey) {
    try {
      return await decomposeWithLLM(query, apiKey);
    } catch (err) {
      console.warn("[Orchestrator] LLM decomposition failed, using heuristic:", err);
    }
  }

  return decomposeHeuristic(query);
}

async function decomposeWithLLM(query: string, apiKey: string): Promise<SubTask[]> {
  const systemPrompt = `You are a task planner for an AI agent marketplace. Given a user query, decompose it into 2-4 sequential sub-tasks that different specialist agents will execute.

Available agent types: research, writer, coder, formatter, analyst, translator

Respond with ONLY a JSON array. Each object has:
- "agent": one of the agent types above
- "description": a clear instruction for that specific agent (1-2 sentences)

The agents execute in order. Each agent receives the output of the previous one as context.

Examples:
User: "Research the latest AI models, write a comparison report, and format it as markdown"
[{"agent":"research","description":"Research the latest AI language models released in 2024-2025, including GPT-4o, Claude 4, Gemini 2, and Llama 3.3. List key capabilities, pricing, and benchmarks."},{"agent":"writer","description":"Write a structured comparison report based on the research findings. Include an introduction, comparison table, pros/cons for each model, and a recommendation."},{"agent":"formatter","description":"Format the report as clean, readable markdown with proper headings, tables, bullet points, and code blocks where appropriate."}]

User: "Find the top 5 JavaScript frameworks, compare their performance, and write sample code for each"
[{"agent":"research","description":"Find the top 5 most popular JavaScript frameworks in 2025 with their GitHub stars, npm downloads, and key features."},{"agent":"analyst","description":"Compare the performance characteristics of each framework: bundle size, render speed, memory usage, and developer experience ratings."},{"agent":"coder","description":"Write a minimal 'Hello World' sample application for each of the 5 frameworks, demonstrating their core syntax and patterns."}]`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      max_tokens: 800,
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Groq API error");

  const content = data.choices[0].message.content.trim();

  // Extract JSON array from response (handle markdown code blocks)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array in LLM response");

  const parsed: Array<{ agent: string; description: string }> = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed) || parsed.length < 2) throw new Error("Invalid decomposition");

  return parsed
    .filter((t) => ORCHESTRATION_AGENTS[t.agent])
    .map((t, i) => ({
      id: `task-${i + 1}`,
      description: t.description,
      ...ORCHESTRATION_AGENTS[t.agent],
    }));
}

function decomposeHeuristic(query: string): SubTask[] {
  const q = query.toLowerCase();
  const tasks: SubTask[] = [];

  // Detect research/find phase
  if (/\b(?:research|find|search|look up|investigate|compare)\b/.test(q)) {
    tasks.push({
      id: `task-${tasks.length + 1}`,
      description: `Research and gather information about: ${query.split(/,|then|and then/i)[0].trim()}`,
      ...ORCHESTRATION_AGENTS.research,
    });
  }

  // Detect analysis phase
  if (/\b(?:compare|analyze|evaluate|assess)\b/.test(q)) {
    tasks.push({
      id: `task-${tasks.length + 1}`,
      description: `Analyze and compare the findings from the research phase.`,
      ...ORCHESTRATION_AGENTS.analyst,
    });
  }

  // Detect code phase
  if (/\b(?:code|implement|program|function|build|develop)\b/.test(q)) {
    tasks.push({
      id: `task-${tasks.length + 1}`,
      description: `Write code or implementation based on the analysis.`,
      ...ORCHESTRATION_AGENTS.coder,
    });
  }

  // Detect writing phase
  if (/\b(?:write|create|draft|compose|report|summary|document)\b/.test(q)) {
    tasks.push({
      id: `task-${tasks.length + 1}`,
      description: `Write a clear, structured document based on the gathered information.`,
      ...ORCHESTRATION_AGENTS.writer,
    });
  }

  // Detect translation phase
  if (/\b(?:translate|translation)\b/.test(q)) {
    tasks.push({
      id: `task-${tasks.length + 1}`,
      description: `Translate the content as requested.`,
      ...ORCHESTRATION_AGENTS.translator,
    });
  }

  // Detect formatting phase
  if (/\b(?:format|markdown|html|style|output as|convert to)\b/.test(q)) {
    tasks.push({
      id: `task-${tasks.length + 1}`,
      description: `Format the output as requested: ${query.split(/format|markdown|output/i).pop()?.trim() || "clean markdown"}`,
      ...ORCHESTRATION_AGENTS.formatter,
    });
  }

  // Ensure at least 2 tasks (otherwise it's not really multi-step)
  if (tasks.length < 2) {
    // Fall back to research + writer
    return [
      {
        id: "task-1",
        description: `Research and gather information about: ${query}`,
        ...ORCHESTRATION_AGENTS.research,
      },
      {
        id: "task-2",
        description: `Synthesize the findings into a clear, helpful response.`,
        ...ORCHESTRATION_AGENTS.writer,
      },
    ];
  }

  return tasks;
}

// =============================================================================
// SOLANA PAYMENT FOR AGENT DELEGATION
// =============================================================================

let _connection: Connection | null = null;
let _payer: Keypair | null = null;

function getSolanaConnection(): Connection {
  if (!_connection) {
    const network = process.env.SOLANA_NETWORK || "devnet";
    const rpc =
      network === "mainnet-beta"
        ? "https://api.mainnet-beta.solana.com"
        : "https://api.devnet.solana.com";
    _connection = new Connection(rpc, "confirmed");
  }
  return _connection;
}

function getPayerKeypair(): Keypair | null {
  if (_payer) return _payer;
  const keyEnv = process.env.X402_CLIENT_PRIVATE_KEY;
  if (!keyEnv) return null;

  try {
    let bytes: Uint8Array;
    if (keyEnv.startsWith("[")) {
      bytes = new Uint8Array(JSON.parse(keyEnv));
    } else if (/^[0-9a-fA-F]{128}$/.test(keyEnv)) {
      bytes = new Uint8Array(Buffer.from(keyEnv, "hex"));
    } else {
      // base58 — would need bs58 import; skip for now
      return null;
    }
    _payer = Keypair.fromSecretKey(bytes);
    return _payer;
  } catch {
    return null;
  }
}

/**
 * Fire a real Solana devnet transaction to represent an agent-to-agent payment.
 * Transfers a small SOL amount (the agent's cost in lamports) from the orchestrator
 * wallet to itself (self-transfer on devnet for demo purposes).
 * Returns the transaction signature.
 */
async function fireAgentPayment(
  agentName: string,
  costLamports: number
): Promise<string | null> {
  const payer = getPayerKeypair();
  if (!payer) {
    console.log(`[Orchestrator] No wallet configured — skipping Solana tx for ${agentName}`);
    return null;
  }

  try {
    const connection = getSolanaConnection();
    // Transfer cost in lamports (min 5000 for tx fee viability on devnet)
    const transferAmount = Math.max(costLamports, 5000);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: payer.publicKey, // self-transfer for demo (visible on explorer)
        lamports: transferAmount,
      })
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: "confirmed",
    });

    console.log(
      `[Orchestrator] x402 payment: ${agentName} → ${transferAmount} lamports → tx: ${sig}`
    );
    return sig;
  } catch (err: any) {
    console.error(`[Orchestrator] Solana tx failed for ${agentName}:`, err.message);
    return null;
  }
}

// =============================================================================
// ORCHESTRATION EXECUTION
// =============================================================================

/**
 * Execute a full multi-agent orchestration pipeline.
 * Each sub-task is dispatched to a specialist, streamed to the frontend,
 * and settled with a real Solana payment.
 */
export async function executeOrchestration(
  query: string,
  userId: string,
  onEvent: (event: OrchestrationEvent) => void
): Promise<AgentResult[]> {
  const orchestrationStart = Date.now();

  // 1. Decompose the query
  const tasks = await decomposeTask(query);
  const chainId = `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const totalEstimatedCost = tasks.reduce(
    (sum, t) => sum + Math.ceil(2000 / 1000) * t.ratePer1kTokens,
    0
  );

  // 2. Create delegation context for safety guardrails
  const delegationCtx = createDelegationContext(userId, "orchestrator-001", totalEstimatedCost * 2);

  // 3. Emit the plan
  const plan: OrchestrationPlan = {
    chainId,
    originalQuery: query,
    tasks,
    totalEstimatedCostLamports: totalEstimatedCost,
  };

  onEvent({ type: "orchestration_start", plan });

  // 4. Execute each sub-task sequentially
  const results: AgentResult[] = [];
  let previousOutput = "";

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskStart = Date.now();

    // Validate delegation through guardrails
    const estimatedCost = Math.ceil(2000 / 1000) * task.ratePer1kTokens;
    const validation = validateDelegation({
      fromAgentId: i === 0 ? "orchestrator-001" : tasks[i - 1].agentId,
      toAgentId: task.agentId,
      taskDescription: task.description,
      estimatedCostLamports: estimatedCost,
      context: delegationCtx,
    });

    if (!validation.allowed) {
      console.warn(`[Orchestrator] Delegation blocked: ${validation.reason}`);
      break;
    }

    // Update delegation context
    if (validation.updatedContext) {
      Object.assign(delegationCtx, validation.updatedContext);
    }

    // Emit agent_start
    onEvent({
      type: "agent_start",
      taskId: task.id,
      taskIndex: i,
      totalTasks: tasks.length,
      agent: {
        id: task.agentId,
        name: task.agentName,
        model: task.model,
        provider: task.provider,
      },
      description: task.description,
      estimatedCostLamports: estimatedCost,
    });

    // Build messages for this sub-agent
    const messages: ConversationMessage[] = [];

    // Include previous agent output as context (chaining)
    if (previousOutput) {
      messages.push({
        role: "user",
        content: `Previous agent output:\n\n${previousOutput}\n\n---\n\nNow complete this task: ${task.description}`,
      });
    } else {
      messages.push({
        role: "user",
        content: `${task.description}\n\nOriginal user request: "${query}"`,
      });
    }

    // Build system prompt for this sub-agent
    const systemPrompt = buildOrchestrationPrompt(task, i, tasks.length);

    // Execute the specialist
    const agentSpec = {
      agentId: task.agentId,
      name: task.agentName,
      description: task.description,
      provider: task.provider as any,
      model: task.model,
      taskTypes: [task.type],
      ratePer1kTokens: task.ratePer1kTokens,
      qualityScore: 90,
      reliabilityScore: 95,
      avgLatencyMs: 600,
      isActive: true,
    };

    const execResult = await executeSpecialistRequest(agentSpec, messages, task.type, systemPrompt);
    const latencyMs = Date.now() - taskStart;

    if (!execResult.success) {
      console.error(`[Orchestrator] Agent ${task.agentName} failed: ${execResult.error}`);
      // Still emit what we have
      onEvent({
        type: "agent_complete",
        taskId: task.id,
        agentName: task.agentName,
        costLamports: 0,
        txSignature: null,
        usage: execResult.usage,
        latencyMs,
      });
      continue;
    }

    // Stream the response in chunks
    const words = execResult.response.split(" ");
    const chunkSize = 4;
    let accumulated = "";

    for (let w = 0; w < words.length; w += chunkSize) {
      const chunk = words.slice(w, w + chunkSize).join(" ") + (w + chunkSize < words.length ? " " : "");
      accumulated += chunk;

      onEvent({
        type: "agent_chunk",
        taskId: task.id,
        text: chunk,
        accumulated,
      });

      await new Promise((r) => setTimeout(r, 40));
    }

    // Calculate actual cost
    const actualCost = Math.ceil(execResult.usage.totalTokens / 1000) * task.ratePer1kTokens;

    // Fire real Solana payment
    const txSignature = await fireAgentPayment(task.agentName, actualCost);

    // Emit agent_complete
    onEvent({
      type: "agent_complete",
      taskId: task.id,
      agentName: task.agentName,
      costLamports: actualCost,
      txSignature,
      usage: execResult.usage,
      latencyMs,
    });

    results.push({
      taskId: task.id,
      agentName: task.agentName,
      content: execResult.response,
      usage: execResult.usage,
      costLamports: actualCost,
      latencyMs,
      txSignature,
    });

    // Chain output to next agent
    previousOutput = execResult.response;
  }

  // Record delegation completion
  const totalCost = results.reduce((s, r) => s + r.costLamports, 0);
  recordDelegationComplete(delegationCtx, true, totalCost);

  // Emit orchestration complete
  const totalLatencyMs = Date.now() - orchestrationStart;
  onEvent({
    type: "orchestration_complete",
    totalCostLamports: totalCost,
    totalLatencyMs,
    agentCount: results.length,
    chainId,
    results,
  });

  return results;
}

// =============================================================================
// SYSTEM PROMPTS FOR ORCHESTRATED AGENTS
// =============================================================================

function buildOrchestrationPrompt(task: SubTask, index: number, total: number): string {
  const positionLabel =
    index === 0
      ? "first"
      : index === total - 1
      ? "final"
      : `step ${index + 1} of ${total}`;

  return `You are the ${task.agentName} in Monocle's multi-agent pipeline. You are the ${positionLabel} agent in a ${total}-agent chain.

Your specific task: ${task.description}

Guidelines:
- Be thorough but concise — your output feeds the next agent in the chain.
- Focus ONLY on your assigned task. Don't repeat work from previous agents.
${index > 0 ? "- You will receive the previous agent's output as context. Build on it, don't start from scratch." : "- You are the first agent. Do the foundational work that downstream agents will build on."}
${index === total - 1 ? "- You are the final agent. Produce the polished, user-ready output." : "- Your output will be passed to the next agent as input."}
- Be direct. Skip preamble like "Sure!" or "Here's the result."`;
}
