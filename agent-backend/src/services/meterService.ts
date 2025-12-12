import { query } from "../db/client";

export async function logToolCall(agentId: string, toolName: string, tokensUsed: number, payload?: unknown, cost = 0.0001) {
  try {
    await query(
      "insert into tool_calls(agent_id, tool_name, tokens_used, cost, payload) values ($1,$2,$3,$4,$5)",
      [agentId, toolName, tokensUsed, cost, payload]
    );
  } catch (err) {
    // Gracefully handle DB errors (e.g., no database in dev mode)
    console.warn("⚠️  Meter logging failed (DB unavailable, using mock mode):", (err as Error).message);
  }
  return { agentId, toolName, tokensUsed, cost };
}

