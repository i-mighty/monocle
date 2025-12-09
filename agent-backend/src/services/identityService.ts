import { query } from "../db/client";

export async function verifyAgent(agentId: string) {
  const res = await query("select id from agents where id = $1", [agentId]);
  return res.rowCount > 0;
}

