export type AgentProvider = 'openai' | 'anthropic' | 'google' | 'custom';

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
  type: 'routing' | 'chunk' | 'done' | 'error' | 'STREAM_ERROR';
  // chunk events
  text?: string;
  accumulated?: string;
  // routing events
  taskType?: string;
  confidence?: number;
  agent?: { id: string; name: string; model: string };
  // done events
  done?: boolean;
  finish_reason?: string;
  conversationId?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost?: { totalLamports: number; breakdown: { agentCost: number; platformFee: number } };
  routing?: { taskType: string; confidence: number };
  latencyMs?: number;
  // error events
  error?: { code: string; message: string } | string;
  partialContent?: string;
  tokensConsumed?: number;
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
  timestamp: Date;
  streaming?: boolean;
  attachments?: Attachment[];
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
