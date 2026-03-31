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

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ORCHESTRATOR_ID = "orchestrator-001";
const MAX_DEPTH = 3;

// ─── Specialist registry ──────────────────────────────────────────────────────
// Maps task types to agent IDs (matches agents seeded in migration)
const SPECIALIST_MAP: Record<string, { agentId: string; name: string }> = {
  research:   { agentId: "researcher-001",  name: "Research Agent" },
  write:      { agentId: "writer-001",       name: "Writer Agent" },
  code:       { agentId: "coder-001",        name: "Code Agent" },
  factcheck:  { agentId: "factcheck-001",    name: "FactCheck Agent" },
  format:     { agentId: "formatter-001",    name: "Formatter Agent" },
  general:    { agentId: "researcher-001",   name: "Research Agent" },
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

Available agent types: research, write, code, factcheck, format, general

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

// ─── Execute a single subtask via Groq ────────────────────────────────────────
async function executeSubtask(
  sessionId: string,
  task: SubTask,
  previousResults: Map<string, string>,
  callerAgentId: string
): Promise<{ result: string; tokensUsed: number }> {
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

  // Depth-2 sub-delegation: researcher might request fact-checking
  if (task.depth < MAX_DEPTH - 1 && task.type === "research" && tokensUsed > 500) {
    await maybeSubDelegate(sessionId, task, result, specialist.agentId);
  }

  return { result, tokensUsed };
}

// ─── Optional sub-delegation (depth 2) ───────────────────────────────────────
async function maybeSubDelegate(
  sessionId: string,
  parentTask: SubTask,
  parentResult: string,
  parentAgentId: string
): Promise<void> {
  const subTask: SubTask = {
    id: `${parentTask.id}-factcheck`,
    type: "factcheck",
    description: `Verify key claims in this research: ${parentResult.slice(0, 300)}`,
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
    message: "Research Agent is delegating fact-checking to FactCheck Agent",
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

    const { result, tokensUsed } = await executeSubtask(
      sessionId, subTask, new Map(), parentAgentId
    );

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
      // Negotiate price
      const negotiation = await negotiateAndPay({
        sessionId,
        requesterId: ORCHESTRATOR_ID,
        providerId: specialist.agentId,
        taskType: task.type,
        taskDescription: task.description,
        estimatedTokens: task.estimatedTokens,
        maxBudgetLamports: task.maxBudget,
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
