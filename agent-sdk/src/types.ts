export type AgentSdkOptions = {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
};

export type VerifyResponse = { valid: boolean; agentId: string };
export type MeterLog = { agentId: string; toolName: string; payload?: unknown; cost?: number };
export type PaymentRequest = { sender: string; receiver: string; amount: number };
export type PaymentResponse = { signature: string };

export class AgentSdkError extends Error {
  constructor(msg: string, public code?: string, public cause?: unknown) {
    super(msg);
  }
}

