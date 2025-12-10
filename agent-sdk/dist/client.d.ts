import { AgentSdkOptions } from "./types";
export declare class AgentPayClient {
    private baseUrl;
    private apiKey;
    private maxRetries;
    private timeoutMs;
    constructor(opts: AgentSdkOptions);
    private request;
    verifyIdentity(input: {
        firstName: string;
        lastName: string;
        dob: string;
        idNumber: string;
    }): Promise<any>;
    /**
     * Alias for logging/metering only, without performing a tool action.
     */
    logToolCall(agentId: string, toolName: string, tokensUsed: number, payload?: object): Promise<any>;
    callTool(agentId: string, toolName: string, payload: object, tokensUsed?: number): Promise<{
        ok: boolean;
        echo: object;
    }>;
    payAgent(senderWallet: string, receiverWallet: string, lamports: number): Promise<any>;
}
