/**
 * agentOrchestrationService.ts
 *
 * Orchestrates multi-agent workflows:
 *   1. Decomposes user prompt into subtasks
 *   2. Assigns each subtask to the best specialist
 *   3. Negotiates price with each specialist (via agentNegotiationService)
 *   4. Executes subtasks (with optional sub-delegation at depth 2)
 *   5. Assembles final response
 *   6. Streams all events to UI via SSE
 */

import { query } from "../db/client";
import {
  negotiateAndPay,
  logResultMessage,
  emitNegotiationEvent,
} from "./agentNegotiationService";
import { initializeAgentIdentities, signMessage, verifyAgentMessage } from "./agentIdentityService";
import { updateReputation, getAgentReputations, reputationAdjustedBudget } from "./onChainReputationService";
import { initializeSolNames, getSolName } from "./snsIdentityService";
import { initializeAgentDWallets, getDWalletInfo, approvePayment, checkSpendingPolicy, getSpendingPolicy } from "./ikaDWalletService";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const IMAGE_GEN_API_KEY = process.env.TOGETHER_API_KEY ?? process.env.IMAGE_GEN_API_KEY;
const ORCHESTRATOR_ID = "orchestrator-001";
const MAX_DEPTH = 3;
const GROQ_VISION_MODEL = "llama-3.2-90b-vision-preview";

// ─── Specialist registry ──────────────────────────────────────────────────────
// Maps task types to agent IDs (matches agents seeded in migration)
const SPECIALIST_MAP: Record<string, { agentId: string; name: string; solName: string }> = {
  research:   { agentId: "researcher-001",  name: "Research Agent",   solName: "researcher.monocle.sol" },
  write:      { agentId: "writer-001",       name: "Writer Agent",     solName: "writer.monocle.sol" },
  code:       { agentId: "coder-001",        name: "Code Agent",       solName: "coder.monocle.sol" },
  image:      { agentId: "image-001",        name: "Image Agent",      solName: "image.monocle.sol" },
  factcheck:  { agentId: "factcheck-001",    name: "FactCheck Agent",  solName: "factcheck.monocle.sol" },
  format:     { agentId: "formatter-001",    name: "Formatter Agent",  solName: "formatter.monocle.sol" },
  general:    { agentId: "researcher-001",   name: "Research Agent",   solName: "researcher.monocle.sol" },
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SubTask {
  id: string;
  type: keyof typeof SPECIALIST_MAP;
  description: string;
  estimatedTokens: number;
  maxBudget: number;
  dependsOn?: string[];   // subtask IDs this depends on
  depth: number;
  parentAgentId: string;
}

export interface OrchestrationResult {
  sessionId: string;
  finalResponse: string;
  totalCostLamports: bigint;
  agentCount: number;
  subtasks: SubtaskResult[];
  durationMs: number;
}

interface SubtaskResult {
  taskId: string;
  agentId: string;
  agentName: string;
  taskType: string;
  result: string;
  costLamports: bigint;
  tokensUsed: number;
  txSignature?: string;
}

// ─── Decompose prompt into subtasks using Groq ────────────────────────────────
async function decomposeTask(
  sessionId: string,
  userPrompt: string
): Promise<SubTask[]> {
  emitNegotiationEvent(sessionId, {
    type: "orchestrator_thinking",
    message: "Analyzing task and planning agent assignments...",
    timestamp: new Date().toISOString(),
  });

  if (!GROQ_API_KEY) {
    // Fallback decomposition for demo without API key
    return fallbackDecompose(userPrompt);
  }

  const systemPrompt = `You are an AI orchestrator. Given a user request, decompose it into 2-4 subtasks that can be executed by specialist agents in parallel or sequence.

Available agent types: research, write, code, image, factcheck, format, general
- Use "image" for any task that involves generating, creating, or drawing images/pictures/illustrations/diagrams.

Respond ONLY with valid JSON array. No markdown, no explanation:
[
  {
    "id": "task-1",
    "type": "research",
    "description": "specific task description",
    "estimatedTokens": 800,
    "maxBudget": 2000,
    "dependsOn": []
  }
]

Rules:
- 2-4 subtasks maximum
- estimatedTokens between 300-1500
- maxBudget between 500-5000 lamports
- dependsOn contains task IDs that must complete first
- Keep descriptions specific and actionable`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Decompose this task: "${userPrompt}"` },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "[]";

    // Strip any markdown fences
    const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
    const parsed: Omit<SubTask, "depth" | "parentAgentId">[] = JSON.parse(clean);

    return parsed.map((t) => ({
      ...t,
      type: (t.type in SPECIALIST_MAP ? t.type : "general") as keyof typeof SPECIALIST_MAP,
      depth: 1,
      parentAgentId: ORCHESTRATOR_ID,
    }));
  } catch (e) {
    console.error("Decomposition failed, using fallback:", e);
    return fallbackDecompose(userPrompt);
  }
}

function fallbackDecompose(prompt: string): SubTask[] {
  const lower = prompt.toLowerCase();
  const tasks: SubTask[] = [];

  if (lower.includes("research") || lower.includes("find") || lower.includes("what")) {
    tasks.push({
      id: "task-1", type: "research",
      description: `Research and gather information about: ${prompt}`,
      estimatedTokens: 800, maxBudget: 2000, dependsOn: [],
      depth: 1, parentAgentId: ORCHESTRATOR_ID,
    });
  }
  if (lower.includes("write") || lower.includes("report") || lower.includes("explain")) {
    tasks.push({
      id: "task-2", type: "write",
      description: `Write a clear, structured response about: ${prompt}`,
      estimatedTokens: 1000, maxBudget: 3000, dependsOn: tasks.length > 0 ? ["task-1"] : [],
      depth: 1, parentAgentId: ORCHESTRATOR_ID,
    });
  }
  if (lower.includes("code") || lower.includes("function") || lower.includes("implement")) {
    tasks.push({
      id: "task-code", type: "code",
      description: `Write code for: ${prompt}`,
      estimatedTokens: 900, maxBudget: 2500, dependsOn: [],
      depth: 1, parentAgentId: ORCHESTRATOR_ID,
    });
  }

  if (lower.includes("image") || lower.includes("picture") || lower.includes("draw")
      || lower.includes("illustration") || lower.includes("generate an image")
      || lower.includes("photo") || lower.includes("diagram")) {
    tasks.push({
      id: "task-image", type: "image",
      description: `Generate an image for: ${prompt}`,
      estimatedTokens: 500, maxBudget: 2000, dependsOn: [],
      depth: 1, parentAgentId: ORCHESTRATOR_ID,
    });
  }

  if (tasks.length === 0) {
    tasks.push({
      id: "task-1", type: "research",
      description: prompt,
      estimatedTokens: 700, maxBudget: 2000, dependsOn: [],
      depth: 1, parentAgentId: ORCHESTRATOR_ID,
    });
    tasks.push({
      id: "task-2", type: "write",
      description: `Write a comprehensive response about: ${prompt}`,
      estimatedTokens: 800, maxBudget: 2500, dependsOn: ["task-1"],
      depth: 1, parentAgentId: ORCHESTRATOR_ID,
    });
  }

  return tasks;
}

// ─── Image generation via Together AI (Flux) ─────────────────────────────────
const TOGETHER_IMAGE_URL = "https://api.together.xyz/v1/images/generations";

async function executeImageGeneration(
  sessionId: string,
  task: SubTask,
  previousResults: Map<string, string>,
): Promise<{ result: string; tokensUsed: number }> {
  const specialist = SPECIALIST_MAP.image;

  // Build context from dependencies for richer prompts
  const context = (task.dependsOn ?? [])
    .map((id) => previousResults.get(id))
    .filter(Boolean)
    .join("\n");

  const imagePrompt = context
    ? `${task.description}\n\nAdditional context: ${context.slice(0, 200)}`
    : task.description;

  emitNegotiationEvent(sessionId, {
    type: "agent_executing",
    depth: task.depth,
    agentId: specialist.agentId,
    agentName: specialist.name,
    taskType: "image",
    taskDescription: task.description,
    timestamp: new Date().toISOString(),
  });

  if (!IMAGE_GEN_API_KEY) {
    // Simulation mode — return a placeholder
    await sleep(1200);
    const placeholder = `[Image generated for: "${task.description.slice(0, 80)}"]\nhttps://placehold.co/1024x1024/1a1a2e/b4a9ff?text=Monocle+Image+Agent`;
    return { result: placeholder, tokensUsed: task.estimatedTokens };
  }

  try {
    const response = await fetch(TOGETHER_IMAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${IMAGE_GEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: "black-forest-labs/FLUX.1-schnell-Free",
        prompt: imagePrompt.slice(0, 1000),
        width: 1024,
        height: 1024,
        n: 1,
        response_format: "url",
      }),
    });

    const data = await response.json();
    const imageUrl = data.data?.[0]?.url;

    if (!imageUrl) {
      return {
        result: `[Image generation failed: ${data.error?.message ?? "No URL returned"}]`,
        tokensUsed: task.estimatedTokens,
      };
    }

    const result = `![Generated Image](${imageUrl})\n\nPrompt: ${imagePrompt.slice(0, 200)}`;
    // Trigger multimodal verification sub-delegation for images
    if (task.depth < MAX_DEPTH - 1) {
      await maybeSubDelegate(sessionId, task, result, SPECIALIST_MAP.image.agentId);
    }
    return { result, tokensUsed: task.estimatedTokens };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      result: `[Image generation error: ${msg}]`,
      tokensUsed: task.estimatedTokens,
    };
  }
}

// ─── Multimodal verification via Groq Vision ─────────────────────────────────
async function executeMultimodalVerification(
  sessionId: string,
  task: SubTask,
  imageUrl: string,
): Promise<{ result: string; tokensUsed: number }> {
  const specialist = SPECIALIST_MAP.factcheck;

  emitNegotiationEvent(sessionId, {
    type: "agent_executing",
    depth: task.depth,
    agentId: specialist.agentId,
    agentName: specialist.name,
    taskType: "factcheck",
    taskDescription: task.description,
    timestamp: new Date().toISOString(),
  });

  if (!GROQ_API_KEY) {
    await sleep(800);
    return {
      result: `[Vision review of image: alignment 8/10, no issues detected]`,
      tokensUsed: task.estimatedTokens,
    };
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: task.description,
              },
              {
                type: "image_url",
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        max_tokens: 512,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content ?? "Vision review unavailable";
    const tokensUsed = data.usage?.total_tokens ?? task.estimatedTokens;
    return { result, tokensUsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      result: `[Vision verification error: ${msg}]`,
      tokensUsed: task.estimatedTokens,
    };
  }
}

// ─── Execute a single subtask via Groq ────────────────────────────────────────
async function executeSubtask(
  sessionId: string,
  task: SubTask,
  previousResults: Map<string, string>,
  callerAgentId: string
): Promise<{ result: string; tokensUsed: number }> {
  // Route image tasks to the image generation pipeline
  if (task.type === "image") {
    return executeImageGeneration(sessionId, task, previousResults);
  }

  const specialist = SPECIALIST_MAP[task.type];

  // Build context from dependencies
  const context = (task.dependsOn ?? [])
    .map((id) => previousResults.get(id))
    .filter(Boolean)
    .join("\n\n---\n\n");

  const systemPrompts: Record<string, string> = {
    research:  "You are a research specialist. Find and synthesize accurate information. Be thorough and cite specific details.",
    write:     "You are a writing specialist. Create clear, well-structured, engaging content. Use the research context provided.",
    code:      "You are a code specialist. Write clean, working, well-commented code. Include usage examples.",
    factcheck: "You are a fact-checking specialist. Verify claims and identify any inaccuracies. Be precise.",
    format:    "You are a formatting specialist. Structure content clearly with proper markdown, headers, and organization.",
    general:   "You are a helpful AI assistant. Provide accurate, comprehensive responses.",
  };

  const userMessage = context
    ? `Context from previous agents:\n${context}\n\nYour task: ${task.description}`
    : task.description;

  emitNegotiationEvent(sessionId, {
    type: "agent_executing",
    depth: task.depth,
    agentId: specialist.agentId,
    agentName: specialist.name,
    taskType: task.type,
    taskDescription: task.description,
    timestamp: new Date().toISOString(),
  });

  if (!GROQ_API_KEY) {
    await sleep(800);
    return {
      result: `[${specialist.name} result for: ${task.description}]`,
      tokensUsed: task.estimatedTokens,
    };
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompts[task.type] ?? systemPrompts.general },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content ?? "No response";
  const tokensUsed = data.usage?.total_tokens ?? task.estimatedTokens;

  // Depth-2 sub-delegation: verification for research, code, writing, and image tasks
  const VERIFIABLE_TYPES: Set<string> = new Set(["research", "code", "write", "image"]);
  if (task.depth < MAX_DEPTH - 1 && VERIFIABLE_TYPES.has(task.type) && tokensUsed > 500) {
    await maybeSubDelegate(sessionId, task, result, specialist.agentId);
  }

  return { result, tokensUsed };
}

// ─── Verification prompt templates per task type ─────────────────────────────
const VERIFICATION_PROMPTS: Record<string, (result: string) => string> = {
  research: (r) => `Verify key claims in this research for factual accuracy: ${r.slice(0, 300)}`,
  code:     (r) => `Review this code for bugs, security vulnerabilities, and correctness: ${r.slice(0, 300)}`,
  write:    (r) => `Check this text for factual accuracy, grammar issues, and tone consistency: ${r.slice(0, 300)}`,
  image:    (r) => `Review this generated image for alignment with the original prompt, visual quality, and any artifacts or inappropriate content. Original request: ${r.slice(0, 200)}`,
};

const DELEGATION_MESSAGES: Record<string, (from: string) => string> = {
  research: (from) => `${from} is delegating fact-checking to FactCheck Agent`,
  code:     (from) => `${from} is delegating code review to FactCheck Agent`,
  write:    (from) => `${from} is delegating quality review to FactCheck Agent`,
  image:    (from) => `${from} is delegating visual verification to FactCheck Agent (vision model)`,
};

// ─── Optional sub-delegation (depth 2) ───────────────────────────────────────
async function maybeSubDelegate(
  sessionId: string,
  parentTask: SubTask,
  parentResult: string,
  parentAgentId: string
): Promise<void> {
  const promptFn = VERIFICATION_PROMPTS[parentTask.type];
  const msgFn = DELEGATION_MESSAGES[parentTask.type];
  if (!promptFn || !msgFn) return; // unsupported type — skip

  const fromName = SPECIALIST_MAP[parentTask.type]?.name ?? parentAgentId;

  const subTask: SubTask = {
    id: `${parentTask.id}-factcheck`,
    type: "factcheck",
    description: promptFn(parentResult),
    estimatedTokens: 400,
    maxBudget: 1000,
    dependsOn: [parentTask.id],
    depth: 2,
    parentAgentId,
  };

  emitNegotiationEvent(sessionId, {
    type: "sub_delegation",
    depth: 2,
    fromAgent: { id: parentAgentId },
    toAgent: SPECIALIST_MAP.factcheck,
    message: msgFn(fromName),
    timestamp: new Date().toISOString(),
  });

  try {
    const neg = await negotiateAndPay({
      sessionId,
      requesterId: parentAgentId,
      providerId: SPECIALIST_MAP.factcheck.agentId,
      taskType: "factcheck",
      taskDescription: subTask.description,
      estimatedTokens: subTask.estimatedTokens,
      maxBudgetLamports: subTask.maxBudget,
      depth: 2,
    });

    let result: string;
    let tokensUsed: number;

    if (parentTask.type === "image") {
      // Extract image URL from the parent result (markdown image or raw URL)
      const urlMatch = parentResult.match(/https?:\/\/[^\s)]+/);
      const imageUrl = urlMatch?.[0] ?? "";

      if (imageUrl) {
        ({ result, tokensUsed } = await executeMultimodalVerification(
          sessionId, subTask, imageUrl
        ));
      } else {
        // No URL found — fall back to text-based review
        ({ result, tokensUsed } = await executeSubtask(
          sessionId, subTask, new Map(), parentAgentId
        ));
      }
    } else {
      ({ result, tokensUsed } = await executeSubtask(
        sessionId, subTask, new Map(), parentAgentId
      ));
    }

    const cost = BigInt(neg.agreedLamports);
    await logResultMessage(
      sessionId, SPECIALIST_MAP.factcheck.agentId, parentAgentId,
      result, cost, tokensUsed, 2
    );
  } catch (e) {
    // Sub-delegation failure is non-fatal
    console.warn("Sub-delegation failed (non-fatal):", e);
  }
}

// ─── MAIN ORCHESTRATION ENTRY POINT ──────────────────────────────────────────
export async function orchestrateTask(
  sessionId: string,
  userPrompt: string,
  userId: string = "anonymous"
): Promise<OrchestrationResult> {
  const startTime = Date.now();

  // Initialize agent identities (generates keypairs, stores public keys)
  await initializeAgentIdentities();
  await initializeSolNames();
  await initializeAgentDWallets();

  // Create session record
  await query(
    `INSERT INTO orchestration_sessions (id, user_id, original_prompt, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (id) DO NOTHING`,
    [sessionId, userId, userPrompt]
  );

  emitNegotiationEvent(sessionId, {
    type: "session_started",
    sessionId,
    userPrompt,
    orchestratorId: ORCHESTRATOR_ID,
    orchestratorSolName: "orchestrator.monocle.sol",
    timestamp: new Date().toISOString(),
  });

  // Update status
  await query(
    `UPDATE orchestration_sessions SET status = 'negotiating' WHERE id = $1`,
    [sessionId]
  );

  // 1. Decompose task
  const subtasks = await decomposeTask(sessionId, userPrompt);

  emitNegotiationEvent(sessionId, {
    type: "task_plan",
    sessionId,
    subtasks: subtasks.map((t) => ({
      id: t.id,
      type: t.type,
      description: t.description,
      assignedAgent: SPECIALIST_MAP[t.type],
      estimatedTokens: t.estimatedTokens,
    })),
    timestamp: new Date().toISOString(),
  });

  // 2. Save plan
  await query(
    `UPDATE orchestration_sessions SET task_plan = $1, status = 'executing' WHERE id = $2`,
    [JSON.stringify(subtasks), sessionId]
  );

  // 3. Execute subtasks in dependency order
  const results = new Map<string, string>();
  const subtaskResults: SubtaskResult[] = [];
  let totalCostLamports = 0n;

  for (const task of subtasks) {
    // Wait for dependencies
    if (task.dependsOn && task.dependsOn.length > 0) {
      const pending = task.dependsOn.filter((id) => !results.has(id));
      if (pending.length > 0) {
        emitNegotiationEvent(sessionId, {
          type: "waiting_for_dependency",
          taskId: task.id,
          waitingFor: pending,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const specialist = SPECIALIST_MAP[task.type];

    try {
      // Reputation-adjusted budget: high-rep agents get higher budgets
      let adjustedBudget = task.maxBudget;
      try {
        const [rep] = await getAgentReputations([specialist.agentId]);
        if (rep) {
          adjustedBudget = reputationAdjustedBudget(task.maxBudget, rep.reputationScore);
        }
      } catch (_) { /* fallback to base budget */ }

      // Negotiate price
      const negotiation = await negotiateAndPay({
        sessionId,
        requesterId: ORCHESTRATOR_ID,
        providerId: specialist.agentId,
        taskType: task.type,
        taskDescription: task.description,
        estimatedTokens: task.estimatedTokens,
        maxBudgetLamports: adjustedBudget,
        depth: task.depth,
      });

      // Execute
      const { result, tokensUsed } = await executeSubtask(
        sessionId, task, results, ORCHESTRATOR_ID
      );

      // Record cost
      const actualCost = negotiation.agreedLamports;
      totalCostLamports += actualCost;
      results.set(task.id, result);

      // Log result
      await logResultMessage(
        sessionId, specialist.agentId, ORCHESTRATOR_ID,
        result, actualCost, tokensUsed, task.depth
      );

      // Verify agent identity — sign result and verify signature
      const signed = signMessage(specialist.agentId, {
        sessionId,
        taskId: task.id,
        resultHash: require("crypto").createHash("sha256").update(result).digest("hex").slice(0, 16),
      });
      const verification = await verifyAgentMessage(specialist.agentId, signed);

      emitNegotiationEvent(sessionId, {
        type: "identity_verified",
        depth: task.depth,
        agentId: specialist.agentId,
        agentName: specialist.name,
        solName: specialist.solName,
        publicKey: signed.signerPublicKey,
        verified: verification.valid,
        reason: verification.reason,
        timestamp: new Date().toISOString(),
      });

      // ── dWallet payment authorization ───────────────────────────────
      const dwallet = await getDWalletInfo(specialist.agentId);
      const policyCheck = checkSpendingPolicy(specialist.agentId, Number(actualCost));
      const spendPolicy = getSpendingPolicy(specialist.agentId);

      emitNegotiationEvent(sessionId, {
        type: "dwallet_policy_check",
        depth: task.depth,
        agentId: specialist.agentId,
        agentName: specialist.name,
        solName: specialist.solName,
        dwalletAddress: dwallet?.dwalletAddress,
        policyAllowed: policyCheck.allowed,
        policyReason: policyCheck.reason,
        maxPerTx: spendPolicy.maxPerTransaction,
        dailyCap: spendPolicy.dailyCap,
        remainingToday: spendPolicy.remainingToday,
        timestamp: new Date().toISOString(),
      });

      if (policyCheck.allowed && dwallet) {
        const approval = await approvePayment(
          specialist.agentId,
          ORCHESTRATOR_ID,
          Number(actualCost),
          `task:${task.id}:${task.type}`
        );

        emitNegotiationEvent(sessionId, {
          type: "dwallet_payment_approved",
          depth: task.depth,
          agentId: specialist.agentId,
          agentName: specialist.name,
          solName: specialist.solName,
          dwalletAddress: dwallet.dwalletAddress,
          messageHash: approval.messageHash,
          approvalPda: approval.approvalPda,
          approvalStatus: approval.status,
          approvalTxSignature: approval.txSignature,
          amount: Number(actualCost),
          recipient: ORCHESTRATOR_ID,
          timestamp: new Date().toISOString(),
        });
      }

      // ── Reputation updates ──────────────────────────────────────────
      const repSuccess = await updateReputation(
        specialist.agentId, sessionId, task.id, "success"
      );
      if (verification.valid) {
        await updateReputation(specialist.agentId, sessionId, task.id, "verified");
      } else {
        await updateReputation(specialist.agentId, sessionId, task.id, "verification_fail");
      }
      emitNegotiationEvent(sessionId, {
        type: "reputation_updated",
        depth: task.depth,
        agentId: specialist.agentId,
        agentName: specialist.name,
        solName: specialist.solName,
        previousScore: repSuccess.previousScore,
        newScore: repSuccess.newScore,
        delta: repSuccess.delta + (verification.valid ? 5 : -10),
        reputationTxSignature: repSuccess.txSignature,
        timestamp: new Date().toISOString(),
      });

      subtaskResults.push({
        taskId: task.id,
        agentId: specialist.agentId,
        agentName: specialist.name,
        taskType: task.type,
        result,
        costLamports: actualCost,
        tokensUsed,
      });

      // Save subtask to DB
      await query(
        `INSERT INTO orchestration_subtasks
           (session_id, assigned_agent_id, task_type, task_description,
            status, result, cost_lamports, depth)
         VALUES ($1, $2, $3, $4, 'complete', $5, $6, $7)`,
        [sessionId, specialist.agentId, task.type, task.description,
         result, actualCost.toString(), task.depth]
      );

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Subtask ${task.id} failed:`, errMsg);

      // Reputation penalty for failure
      try {
        const repFail = await updateReputation(
          specialist.agentId, sessionId, task.id, "failure"
        );
        emitNegotiationEvent(sessionId, {
          type: "reputation_updated",
          depth: task.depth,
          agentId: specialist.agentId,
          agentName: specialist.name,
          solName: specialist.solName,
          previousScore: repFail.previousScore,
          newScore: repFail.newScore,
          delta: repFail.delta,
          reputationTxSignature: repFail.txSignature,
          timestamp: new Date().toISOString(),
        });
      } catch (_) { /* reputation update failure is non-fatal */ }

      emitNegotiationEvent(sessionId, {
        type: "subtask_failed",
        taskId: task.id,
        error: errMsg,
        timestamp: new Date().toISOString(),
      });

      results.set(task.id, `[Task failed: ${errMsg}]`);
    }
  }

  // 4. Assemble final response
  await query(
    `UPDATE orchestration_sessions SET status = 'assembling' WHERE id = $1`, [sessionId]
  );

  emitNegotiationEvent(sessionId, {
    type: "assembling",
    message: "Orchestrator is assembling final response from all agents...",
    timestamp: new Date().toISOString(),
  });

  const finalResponse = await assembleFinalResponse(
    sessionId, userPrompt, subtaskResults
  );

  // 5. Complete session
  const durationMs = Date.now() - startTime;

  await query(
    `UPDATE orchestration_sessions
     SET status = 'complete', final_response = $1,
         total_cost_lamports = $2, agent_count = $3, completed_at = NOW()
     WHERE id = $4`,
    [finalResponse, totalCostLamports.toString(), subtaskResults.length, sessionId]
  );

  emitNegotiationEvent(sessionId, {
    type: "session_complete",
    sessionId,
    finalResponse,
    totalCostLamports: totalCostLamports.toString(),
    agentCount: subtaskResults.length,
    durationMs,
    timestamp: new Date().toISOString(),
  });

  return {
    sessionId,
    finalResponse,
    totalCostLamports,
    agentCount: subtaskResults.length,
    subtasks: subtaskResults,
    durationMs,
  };
}

// ─── Assemble final response ──────────────────────────────────────────────────
async function assembleFinalResponse(
  _sessionId: string,
  originalPrompt: string,
  results: SubtaskResult[]
): Promise<string> {
  if (results.length === 1) return results[0].result;

  if (!GROQ_API_KEY) {
    return results.map((r) => `## ${r.agentName}\n\n${r.result}`).join("\n\n---\n\n");
  }

  const context = results
    .map((r) => `### ${r.agentName} (${r.taskType})\n${r.result}`)
    .join("\n\n");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are an orchestrator assembling a final response from multiple specialist agents. Synthesize their outputs into one cohesive, well-structured answer. Do not mention the agents or the orchestration process.",
        },
        {
          role: "user",
          content: `Original request: "${originalPrompt}"\n\nSpecialist outputs:\n${context}\n\nSynthesize into a final response:`,
        },
      ],
      max_tokens: 1500,
      temperature: 0.5,
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? results.map((r) => r.result).join("\n\n");
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
