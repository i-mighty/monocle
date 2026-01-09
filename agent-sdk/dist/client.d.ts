import { AgentSdkOptions } from "./types";
export declare class AgentPayClient {
    private baseUrl;
    private apiKey;
    private maxRetries;
    private timeoutMs;
    constructor(opts: AgentSdkOptions);
    private request;
    verifyIdentity(input: {
        agentId: string;
        firstName: string;
        lastName: string;
        dob: string;
        idNumber: string;
        ratePer1kTokens?: number;
    }): Promise<any>;
    executeTool(callerId: string, calleeId: string, toolName: string, tokensUsed: number, payload?: object): Promise<any>;
    getToolHistory(agentId: string, asCallee?: boolean, limit?: number): Promise<any>;
    getMetrics(agentId: string): Promise<any>;
    settle(agentId: string): Promise<any>;
    getSettlements(agentId: string, limit?: number): Promise<any>;
    topup(agentId: string, lamports: number): Promise<any>;
}
