export type AgentSdkOptions = {
    apiKey: string;
    baseUrl?: string;
    maxRetries?: number;
    timeoutMs?: number;
};
export type VerifyResponse = {
    valid: boolean;
    agentId: string;
};
export type MeterLog = {
    agentId: string;
    toolName: string;
    payload?: unknown;
    cost?: number;
};
export type PaymentRequest = {
    sender: string;
    receiver: string;
    amount: number;
};
export type PaymentResponse = {
    signature: string;
};
export declare class AgentSdkError extends Error {
    code?: string | undefined;
    cause?: unknown | undefined;
    constructor(msg: string, code?: string | undefined, cause?: unknown | undefined);
}
