export type AgentProvider = 'openai' | 'anthropic' | 'google' | 'groq' | 'custom';

export interface Agent {
  agentId: string;
  name: string;
  provider: AgentProvider;
  model: string;
  taskTypes: string[];
  ratePer1kTokens: number;
  reputationScore: number;
  uptime: number;
}

export interface RoutingDecision {
  selectedAgent: Agent;
  taskType: string;
  confidence: number;
  classificationMethod: 'llm' | 'keyword';
  candidatesConsidered: number;
  latencyMs: number;
  estimatedCostLamports: number;
}

export interface StreamChunk {
  type: 'routing' | 'chunk' | 'done' | 'error' | 'STREAM_ERROR'
      | 'orchestration_start' | 'agent_start' | 'agent_chunk' | 'agent_complete' | 'orchestration_complete';
  // chunk events
  text?: string;
  accumulated?: string;
  // routing events
  taskType?: string;
  confidence?: number;
  estimatedCostLamports?: number;
  agent?: { id: string; name: string; model: string; provider?: string };
  // done events
  done?: boolean;
  finish_reason?: string;
  conversationId?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost?: { totalLamports: number; breakdown: { agentCost: number; platformFee: number } };
  routing?: { taskType: string; confidence: number };
  latencyMs?: number;
  txSignature?: string;
  x402AmountUsdc?: number | null;
  // orchestration events
  plan?: { chainId: string; originalQuery: string; tasks: OrchestrationTask[]; totalEstimatedCostLamports: number };
  taskId?: string;
  taskIndex?: number;
  totalTasks?: number;
  description?: string;
  agentName?: string;
  costLamports?: number;
  agentCount?: number;
  chainId?: string;
  totalCostLamports?: number;
  totalLatencyMs?: number;
  results?: OrchestrationResult[];
  // error events
  error?: { code: string; message: string } | string;
  partialContent?: string;
  tokensConsumed?: number;
}

export interface OrchestrationTask {
  id: string;
  type: string;
  description: string;
  agentId: string;
  agentName: string;
  model: string;
  provider: string;
  ratePer1kTokens: number;
}

export interface OrchestrationResult {
  taskId: string;
  agentName: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  costLamports: number;
  latencyMs: number;
  txSignature: string | null;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;        // object URL for local preview
  file?: File;        // original File (not persisted)
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agent?: Pick<Agent, 'name' | 'provider' | 'model'>;
  routing?: RoutingDecision;
  latencyMs?: number;
  costLamports?: number;
  txSignature?: string;
  x402AmountUsdc?: number | null;
  timestamp: Date;
  streaming?: boolean;
  attachments?: Attachment[];
  // Multi-agent orchestration
  isOrchestration?: boolean;
  orchestrationPlan?: { chainId: string; tasks: OrchestrationTask[] };
  taskId?: string;              // Which sub-task this message belongs to
  taskIndex?: number;           // Position in the chain (0-based)
  totalTasks?: number;          // Total agents in the chain
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  lastAgent?: AgentProvider;
}

export interface NetworkNode {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
  glow: string;
  r: number;
  active: boolean;
  provider?: AgentProvider;
}

export interface NetworkEdge {
  from: string;
  to: string;
  active: boolean;
  animOffset: number;
}
