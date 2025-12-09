import { query } from "../db/client";

export async function logToolCall(agentId: string, toolName: string, payload: unknown, cost = 0.0001) {
  await query("insert into tool_calls(agent_id, tool_name, cost, payload) values ($1,$2,$3,$4)", [
    agentId,
    toolName,
    cost,
    payload
  ]);
  return { agentId, toolName, cost };
}

