// =============================================================================
// ROUTER SERVICE: AI Orchestration Layer
// =============================================================================
// Automatically routes user requests to the best specialist agent based on:
// - Task type classification
// - Agent performance metrics
// - Cost efficiency
// - Reliability/uptime
//
// This is the core of the "pay-per-use AI platform powered by agent economics"
// =============================================================================

import { query } from "../db/client";

// =============================================================================
// API KEY AVAILABILITY
// =============================================================================
// Check which providers have API keys configured for real responses

function getAvailableProviders(): Set<string> {
  const available = new Set<string>();
  if (process.env.OPENAI_API_KEY) available.add("openai");
  if (process.env.ANTHROPIC_API_KEY) available.add("anthropic");
  if (process.env.GOOGLE_API_KEY) available.add("google");
  return available;
}

// =============================================================================
// TYPES
// =============================================================================

export type TaskType = 
  | "research"      // Web search, fact-finding, summarization
  | "image"         // Image generation, editing
  | "code"          // Code generation, explanation, debugging
  | "reasoning"     // General chat, analysis, planning
  | "writing"       // Creative writing, documents, emails
  | "math"          // Mathematical calculations, proofs
  | "translation"   // Language translation
  | "unknown";

export interface SpecialistAgent {
  agentId: string;
  name: string;
  description: string;
  taskTypes: TaskType[];
  provider: string;           // openai, anthropic, google, etc.
  model: string;              // gpt-4, claude-3, gemini-pro, etc.
  ratePer1kTokens: number;    // Cost in lamports
  qualityScore: number;       // 0-100 based on user feedback
  reliabilityScore: number;   // 0-100 based on uptime/success rate
  avgLatencyMs: number;       // Average response time
  isActive: boolean;
}

export interface RoutingDecision {
  selectedAgent: SpecialistAgent;
  taskType: TaskType;
  confidence: number;         // 0-1 confidence in classification
  alternativeAgents: SpecialistAgent[];
  reasoning: string;
  classificationMethod: "llm" | "keyword";  // How the task was classified
}

export interface ChatRequest {
  userId: string;
  message: string;
  conversationId?: string;
  preferredTaskType?: TaskType;  // Optional override
  maxCostLamports?: number;      // Budget constraint
  preferQuality?: boolean;       // Prefer quality over cost
}

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  response: string;
  taskType: TaskType;
  agentUsed: {
    agentId: string;
    name: string;
    model: string;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost: {
    totalLamports: number;
    breakdown: {
      agentCost: number;
      platformFee: number;
    };
  };
  latencyMs: number;
  // Fallback information (present when primary agent failed)
  fallbackUsed?: boolean;
  failedAgents?: number;
}

// =============================================================================
// TASK CLASSIFICATION
// =============================================================================

// Keywords and patterns for task classification
const TASK_PATTERNS: Record<TaskType, { keywords: string[]; patterns: RegExp[] }> = {
  research: {
    keywords: ["search", "find", "lookup", "research", "what is", "who is", "when did", "where is", "facts about", "information on", "tell me about", "explain"],
    patterns: [/what (is|are|was|were)/i, /who (is|was|are|were)/i, /when did/i, /where (is|are|was)/i, /how (does|do|did)/i]
  },
  image: {
    keywords: ["image", "picture", "photo", "draw", "generate image", "create image", "illustration", "artwork", "visual", "design", "logo", "icon"],
    patterns: [/generate (an? )?(image|picture|photo)/i, /create (an? )?(image|picture|artwork)/i, /draw (me )?/i, /make (an? )?(image|picture)/i]
  },
  code: {
    keywords: ["code", "program", "function", "class", "debug", "fix bug", "implement", "algorithm", "script", "syntax", "compile", "runtime", "javascript", "python", "typescript", "react", "api"],
    patterns: [/write (a |the |some )?code/i, /fix (this |the |my )?bug/i, /implement/i, /debug/i, /```[\s\S]*```/]
  },
  reasoning: {
    keywords: ["think", "analyze", "consider", "evaluate", "compare", "pros and cons", "decision", "advice", "recommend", "suggest", "opinion", "perspective"],
    patterns: [/what (do you think|would you recommend)/i, /should (i|we)/i, /help me (decide|choose)/i]
  },
  writing: {
    keywords: ["write", "draft", "compose", "email", "letter", "essay", "article", "blog", "story", "creative", "poem", "script", "content"],
    patterns: [/write (a |an |the |me )?(email|letter|essay|article|blog|story)/i, /draft/i, /compose/i]
  },
  math: {
    keywords: ["calculate", "compute", "solve", "equation", "formula", "math", "arithmetic", "algebra", "calculus", "statistics", "probability"],
    patterns: [/calculate/i, /solve/i, /\d+\s*[\+\-\*\/\^]\s*\d+/, /equation/i]
  },
  translation: {
    keywords: ["translate", "translation", "convert to", "in spanish", "in french", "in german", "in chinese", "in japanese", "language"],
    patterns: [/translate/i, /in (spanish|french|german|chinese|japanese|korean|italian|portuguese|russian|arabic)/i]
  },
  unknown: {
    keywords: [],
    patterns: []
  }
};

export function classifyTask(message: string): { taskType: TaskType; confidence: number } {
  const lowerMessage = message.toLowerCase();
  const scores: Record<TaskType, number> = {
    research: 0,
    image: 0,
    code: 0,
    reasoning: 0,
    writing: 0,
    math: 0,
    translation: 0,
    unknown: 0
  };

  // Score based on keywords
  for (const [taskType, { keywords, patterns }] of Object.entries(TASK_PATTERNS)) {
    if (taskType === "unknown") continue;

    // Keyword matching
    for (const keyword of keywords) {
      if (lowerMessage.includes(keyword)) {
        scores[taskType as TaskType] += 1;
      }
    }

    // Pattern matching (weighted higher)
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        scores[taskType as TaskType] += 2;
      }
    }
  }

  // Find highest scoring task type
  let maxScore = 0;
  let bestType: TaskType = "reasoning"; // Default to reasoning for general queries

  for (const [taskType, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestType = taskType as TaskType;
    }
  }

  // Calculate confidence (normalize score)
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0 ? maxScore / totalScore : 0.5;

  // If no strong signal, default to reasoning
  if (maxScore === 0) {
    return { taskType: "reasoning", confidence: 0.5 };
  }

  return { taskType: bestType, confidence: Math.min(confidence + 0.3, 1) };
}

// =============================================================================
// LLM-BASED TASK CLASSIFICATION (PRIMARY)
// =============================================================================

const CLASSIFICATION_PROMPT = `You are a task classifier for an AI routing system. Analyze the user's request and classify it into ONE of these task types:

- research: Information lookup, fact-finding, explanations, "what is", research questions
- code: Programming, debugging, code review, algorithms, software development
- reasoning: Complex analysis, philosophy, strategy, pros/cons, decision making
- math: Calculations, statistics, equations, mathematical proofs
- writing: Creative content, essays, stories, marketing copy, editing
- translation: Language translation, localization
- image: Image generation, picture creation, visual content

Respond with ONLY the task type word, nothing else.

User request: """
{query}
"""

Task type:`;

async function classifyWithLLM(query: string): Promise<TaskType | null> {
  // Try OpenAI first (fastest classifier)
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "user", content: CLASSIFICATION_PROMPT.replace("{query}", query) }
          ],
          max_tokens: 20,
          temperature: 0
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const result = data.choices[0]?.message?.content?.trim().toLowerCase();
        if (isValidTaskType(result)) {
          console.log(`[LLM Router] OpenAI classified as: ${result}`);
          return result as TaskType;
        }
      }
    } catch (error) {
      console.log("[LLM Router] OpenAI classification failed, trying Anthropic");
    }
  }

  // Fallback to Anthropic Haiku
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 20,
          messages: [
            { role: "user", content: CLASSIFICATION_PROMPT.replace("{query}", query) }
          ]
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const result = data.content[0]?.text?.trim().toLowerCase();
        if (isValidTaskType(result)) {
          console.log(`[LLM Router] Anthropic classified as: ${result}`);
          return result as TaskType;
        }
      }
    } catch (error) {
      console.log("[LLM Router] Anthropic classification failed");
    }
  }

  return null; // LLM classification unavailable
}

function isValidTaskType(type: string | undefined): type is TaskType {
  const validTypes: TaskType[] = ["research", "image", "code", "reasoning", "writing", "math", "translation", "unknown"];
  return !!type && validTypes.includes(type as TaskType);
}

/**
 * Smart task classification with LLM + keyword fallback
 * Uses fast LLM (GPT-4o-mini or Haiku) for accurate classification,
 * falls back to keyword matching if LLM is unavailable
 */
export async function classifyTaskSmart(message: string): Promise<{ taskType: TaskType; confidence: number; method: "llm" | "keyword" }> {
  // First try LLM classification (more accurate)
  const llmResult = await classifyWithLLM(message);
  if (llmResult) {
    return { taskType: llmResult, confidence: 0.95, method: "llm" };
  }
  
  // Fallback to keyword-based classification
  const keywordResult = classifyTask(message);
  console.log(`[Keyword Router] Classified as: ${keywordResult.taskType}`);
  return { ...keywordResult, method: "keyword" };
}

// =============================================================================
// SPECIALIST AGENT REGISTRY
// =============================================================================

// Default specialist agents (these would normally come from database)
const DEFAULT_SPECIALISTS: SpecialistAgent[] = [
  {
    agentId: "specialist-research-001",
    name: "Research Agent",
    description: "Expert at finding information, fact-checking, and summarization",
    taskTypes: ["research"],
    provider: "google",
    model: "gemini-2.0-flash",
    ratePer1kTokens: 75,
    qualityScore: 86,
    reliabilityScore: 95,
    avgLatencyMs: 1200,
    isActive: true
  },
  {
    agentId: "specialist-image-001",
    name: "Image Generator",
    description: "Creates images from text descriptions using DALL-E",
    taskTypes: ["image"],
    provider: "openai",
    model: "dall-e-3",
    ratePer1kTokens: 50000, // Higher cost for image generation
    qualityScore: 85,
    reliabilityScore: 90,
    avgLatencyMs: 15000,
    isActive: true
  },
  {
    agentId: "specialist-code-001",
    name: "Code Expert",
    description: "Specialized in code generation, debugging, and explanations",
    taskTypes: ["code"],
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    ratePer1kTokens: 3000,
    qualityScore: 95,
    reliabilityScore: 92,
    avgLatencyMs: 2500,
    isActive: true
  },
  {
    agentId: "specialist-reasoning-001",
    name: "General Assistant",
    description: "Versatile AI for general questions and analysis",
    taskTypes: ["reasoning", "math", "research", "writing", "translation", "unknown"],
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
    ratePer1kTokens: 250,
    qualityScore: 88,
    reliabilityScore: 94,
    avgLatencyMs: 1000,
    isActive: true
  },
  {
    agentId: "specialist-translation-001",
    name: "Translator",
    description: "Accurate translation between languages",
    taskTypes: ["translation", "writing", "unknown"],
    provider: "google",
    model: "gemini-2.0-flash",
    ratePer1kTokens: 75,
    qualityScore: 88,
    reliabilityScore: 96,
    avgLatencyMs: 1000,
    isActive: true
  }
];

export async function getSpecialistAgents(): Promise<SpecialistAgent[]> {
  // In production, these would come from the database
  // For now, return defaults merged with any registered in DB
  try {
    const result = await query(`
      SELECT 
        id as "agentId",
        name,
        description,
        metadata->>'taskTypes' as "taskTypes",
        metadata->>'provider' as provider,
        metadata->>'model' as model,
        rate_per_1k_tokens as "ratePer1kTokens",
        COALESCE((metadata->>'qualityScore')::int, 80) as "qualityScore",
        COALESCE((metadata->>'reliabilityScore')::int, 90) as "reliabilityScore",
        COALESCE((metadata->>'avgLatencyMs')::int, 2000) as "avgLatencyMs",
        COALESCE((metadata->>'isSpecialist')::boolean, false) as "isSpecialist"
      FROM agents
      WHERE metadata->>'isSpecialist' = 'true'
        AND metadata->>'isActive' = 'true'
    `);

    const dbAgents: SpecialistAgent[] = result.rows.map((row: any) => ({
      ...row,
      taskTypes: JSON.parse(row.taskTypes || "[]"),
      isActive: true
    }));

    // Merge with defaults, preferring DB entries
    const agentMap = new Map<string, SpecialistAgent>();
    for (const agent of DEFAULT_SPECIALISTS) {
      agentMap.set(agent.agentId, agent);
    }
    for (const agent of dbAgents) {
      agentMap.set(agent.agentId, agent);
    }

    return Array.from(agentMap.values()).filter(a => a.isActive);
  } catch (error) {
    // If DB query fails, return defaults
    return DEFAULT_SPECIALISTS;
  }
}

// =============================================================================
// AGENT SELECTION (THE SMART ROUTING)
// =============================================================================

interface SelectionWeights {
  quality: number;     // 0-1, how much to weight quality
  cost: number;        // 0-1, how much to weight cost
  reliability: number; // 0-1, how much to weight reliability
  speed: number;       // 0-1, how much to weight speed
}

const DEFAULT_WEIGHTS: SelectionWeights = {
  quality: 0.4,
  cost: 0.3,
  reliability: 0.2,
  speed: 0.1
};

export function selectBestAgent(
  taskType: TaskType,
  agents: SpecialistAgent[],
  weights: SelectionWeights = DEFAULT_WEIGHTS,
  maxCostLamports?: number
): RoutingDecision {
  // Get providers with available API keys
  const availableProviders = getAvailableProviders();
  
  // Filter agents that handle this task type
  let candidates = agents.filter(a => 
    a.taskTypes.includes(taskType) || a.taskTypes.includes("unknown")
  );

  // Strongly prefer agents with available API keys (filter if possible)
  const availableCandidates = candidates.filter(a => availableProviders.has(a.provider));
  if (availableCandidates.length > 0) {
    candidates = availableCandidates;
  }
  // If no agents have keys, fall back to all (will use simulated responses)

  // Apply cost constraint if specified
  if (maxCostLamports) {
    candidates = candidates.filter(a => a.ratePer1kTokens <= maxCostLamports);
  }

  if (candidates.length === 0) {
    // Fallback to general reasoning agent
    const fallback = agents.find(a => a.taskTypes.includes("reasoning")) || agents[0];
    return {
      selectedAgent: fallback,
      taskType,
      confidence: 0.5,
      alternativeAgents: [],
      reasoning: "No specialist available for this task type, using general assistant",
      classificationMethod: "keyword"  // Will be overwritten by routeRequest
    };
  }

  // Score each candidate
  const scored = candidates.map(agent => {
    // Normalize scores to 0-1
    const qualityNorm = agent.qualityScore / 100;
    const reliabilityNorm = agent.reliabilityScore / 100;
    
    // Cost score: lower is better (invert and normalize)
    const maxCost = Math.max(...candidates.map(a => a.ratePer1kTokens));
    const costNorm = 1 - (agent.ratePer1kTokens / maxCost);
    
    // Speed score: lower latency is better
    const maxLatency = Math.max(...candidates.map(a => a.avgLatencyMs));
    const speedNorm = 1 - (agent.avgLatencyMs / maxLatency);

    // Weighted score
    const score = 
      qualityNorm * weights.quality +
      costNorm * weights.cost +
      reliabilityNorm * weights.reliability +
      speedNorm * weights.speed;

    return { agent, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const selected = scored[0].agent;
  const alternatives = scored.slice(1, 4).map(s => s.agent);

  return {
    selectedAgent: selected,
    taskType,
    confidence: scored[0].score,
    alternativeAgents: alternatives,
    reasoning: `Selected ${selected.name} (${selected.model}) for ${taskType} task. ` +
               `Quality: ${selected.qualityScore}/100, Cost: ${selected.ratePer1kTokens} lamports/1k tokens.`,
    classificationMethod: "keyword"  // Will be overwritten by routeRequest
  };
}

// =============================================================================
// MAIN ROUTING FUNCTION
// =============================================================================

export async function routeRequest(
  message: string,
  options: {
    preferredTaskType?: TaskType;
    maxCostLamports?: number;
    preferQuality?: boolean;
  } = {}
): Promise<RoutingDecision> {
  // 1. Classify the task using LLM (with keyword fallback)
  const classification = options.preferredTaskType 
    ? { taskType: options.preferredTaskType, confidence: 1, method: "keyword" as const }
    : await classifyTaskSmart(message);

  console.log(`[Router] Classification: ${classification.taskType} (${classification.method}, confidence: ${classification.confidence})`);

  // 2. Get available specialist agents
  const agents = await getSpecialistAgents();

  // 3. Adjust weights based on preferences
  const weights: SelectionWeights = options.preferQuality
    ? { quality: 0.6, cost: 0.1, reliability: 0.2, speed: 0.1 }
    : DEFAULT_WEIGHTS;

  // 4. Select the best agent
  const decision = selectBestAgent(
    classification.taskType,
    agents,
    weights,
    options.maxCostLamports
  );

  // Update confidence based on classification confidence
  decision.confidence = (decision.confidence + classification.confidence) / 2;
  
  // Add classification method for observability
  decision.classificationMethod = classification.method;

  return decision;
}

// =============================================================================
// LOGGING & ANALYTICS
// =============================================================================

export async function logRoutingDecision(
  userId: string,
  message: string,
  decision: RoutingDecision,
  executionResult?: {
    success: boolean;
    latencyMs: number;
    tokensUsed: number;
    error?: string;
  }
): Promise<void> {
  try {
    await query(`
      INSERT INTO activity_logs (
        event_type, severity, agent_id, actor_id, actor_type,
        resource_type, action, description, metadata
      ) VALUES (
        'routing_decision', 'info', $1, $2, 'user',
        'router', 'route', $3, $4
      )
    `, [
      decision.selectedAgent.agentId,
      userId,
      `Routed "${message.slice(0, 50)}..." to ${decision.selectedAgent.name}`,
      JSON.stringify({
        taskType: decision.taskType,
        confidence: decision.confidence,
        selectedModel: decision.selectedAgent.model,
        alternativeCount: decision.alternativeAgents.length,
        ...executionResult
      })
    ]);
  } catch (error) {
    console.error("Failed to log routing decision:", error);
  }
}
