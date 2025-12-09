import { query } from "../db/client";

export async function logToolCall(agentId: string, toolName: string, tokensUsed: number, payload?: unknown, cost = 0.0001) {
  await query(
    "insert into tool_calls(agent_id, tool_name, tokens_used, cost, payload) values ($1,$2,$3,$4,$5)",
    [agentId, toolName, tokensUsed, cost, payload]
  );
  return { agentId, toolName, tokensUsed, cost };
}

