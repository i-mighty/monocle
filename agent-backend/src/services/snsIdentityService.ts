/**
 * snsIdentityService.ts
 *
 * Solana Name Service (.sol) identity layer for agents.
 *
 *  - Built-in agents get assigned `<name>.monocle.sol` names
 *  - External agents can register with their own `.sol` name
 *  - Resolves `.sol` → wallet address via SNS SDK
 *  - Provides `.sol` name for display across all system events
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { resolve, reverseLookup } from "@bonfida/spl-name-service";
import { query } from "../db/client";

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");

// ─── Default .sol names for built-in agents ───────────────────────────────────
const DEFAULT_SOL_NAMES: Record<string, string> = {
  "orchestrator-001": "orchestrator.monocle.sol",
  "researcher-001":   "researcher.monocle.sol",
  "writer-001":       "writer.monocle.sol",
  "coder-001":        "coder.monocle.sol",
  "image-001":        "image.monocle.sol",
  "factcheck-001":    "factcheck.monocle.sol",
  "formatter-001":    "formatter.monocle.sol",
};

// In-memory cache to avoid repeated DB lookups
const solNameCache = new Map<string, string>();

// ─── Get .sol name for an agent ───────────────────────────────────────────────

/**
 * Returns the .sol name for an agent. Priority:
 *   1. In-memory cache
 *   2. Database `sol_name` column
 *   3. Default mapping for built-in agents
 *   4. Reverse-lookup from SNS using the agent's public_key
 *   5. Falls back to `<agentId>.sol`
 */
export async function getSolName(agentId: string): Promise<string> {
  // 1. Cache
  const cached = solNameCache.get(agentId);
  if (cached) return cached;

  // 2. DB
  try {
    const { rows } = await query(
      `SELECT sol_name, public_key FROM agents WHERE id = $1`,
      [agentId],
    );
    if (rows[0]?.sol_name) {
      solNameCache.set(agentId, rows[0].sol_name);
      return rows[0].sol_name;
    }

    // 4. Try SNS reverse lookup from public_key
    if (rows[0]?.public_key) {
      try {
        const pubkey = new PublicKey(rows[0].public_key);
        const domainName = await reverseLookup(connection, pubkey);
        if (domainName) {
          const solName = `${domainName}.sol`;
          // Persist to DB
          await query(`UPDATE agents SET sol_name = $1 WHERE id = $2`, [solName, agentId]);
          solNameCache.set(agentId, solName);
          return solName;
        }
      } catch {
        // SNS lookup failed — not all keys have .sol names
      }
    }
  } catch {
    // DB not ready — use defaults
  }

  // 3. Default mapping
  const defaultName = DEFAULT_SOL_NAMES[agentId];
  if (defaultName) {
    solNameCache.set(agentId, defaultName);
    return defaultName;
  }

  // 5. Fallback
  const fallback = `${agentId}.sol`;
  solNameCache.set(agentId, fallback);
  return fallback;
}

// ─── Resolve .sol name to Solana wallet address ───────────────────────────────

export interface SolNameResolution {
  solName: string;
  owner: string | null;
  verified: boolean;
  error?: string;
}

/**
 * Resolve a .sol name to its owner's Solana wallet address.
 * Returns null owner if the name doesn't exist on-chain.
 */
export async function resolveSolName(solName: string): Promise<SolNameResolution> {
  const domain = solName.replace(/\.sol$/i, "");

  try {
    const ownerPubkey = await resolve(connection, domain);
    const owner = ownerPubkey.toBase58();
    return { solName, owner, verified: true };
  } catch (err) {
    return {
      solName,
      owner: null,
      verified: false,
      error: `SNS resolution failed: ${(err as Error).message}`,
    };
  }
}

// ─── Verify agent owns the .sol name they claim ──────────────────────────────

/**
 * Verify that an agent's publicKey matches the owner of the .sol name.
 * For built-in agents (*.monocle.sol), verification is always true.
 */
export async function verifySolOwnership(
  solName: string,
  claimedPublicKey: string,
): Promise<{ verified: boolean; reason?: string }> {
  // Built-in monocle.sol subdomains are always verified (self-assigned)
  if (solName.endsWith(".monocle.sol")) {
    return { verified: true };
  }

  const resolution = await resolveSolName(solName);

  if (!resolution.owner) {
    return { verified: false, reason: `${solName} not found on SNS` };
  }

  if (resolution.owner !== claimedPublicKey) {
    return {
      verified: false,
      reason: `${solName} owner ${resolution.owner.slice(0, 8)}… does not match claimed key ${claimedPublicKey.slice(0, 8)}…`,
    };
  }

  return { verified: true };
}

// ─── Assign .sol name to an agent ─────────────────────────────────────────────

/**
 * Set or update the .sol name for an agent in the database.
 */
export async function assignSolName(agentId: string, solName: string): Promise<void> {
  await query(
    `UPDATE agents SET sol_name = $1, updated_at = NOW() WHERE id = $2`,
    [solName, agentId],
  );
  solNameCache.set(agentId, solName);
}

// ─── Initialize .sol names for all built-in agents ────────────────────────────

/**
 * Ensure all built-in agents have their .sol names set in the DB.
 * Called at startup alongside initializeAgentIdentities().
 */
export async function initializeSolNames(): Promise<void> {
  for (const [agentId, solName] of Object.entries(DEFAULT_SOL_NAMES)) {
    try {
      const { rows } = await query(
        `SELECT sol_name FROM agents WHERE id = $1`,
        [agentId],
      );
      if (rows.length > 0 && !rows[0].sol_name) {
        await query(
          `UPDATE agents SET sol_name = $1 WHERE id = $2`,
          [solName, agentId],
        );
      }
      solNameCache.set(agentId, solName);
    } catch {
      // Agent may not exist yet — cache the default anyway
      solNameCache.set(agentId, solName);
    }
  }
  console.log(`[SNS] Initialized .sol names for ${Object.keys(DEFAULT_SOL_NAMES).length} built-in agents`);
}

// ─── Batch resolve .sol names for multiple agents ─────────────────────────────

export async function getSolNames(
  agentIds: string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  // Resolve in parallel
  await Promise.all(
    agentIds.map(async (id) => {
      result[id] = await getSolName(id);
    }),
  );
  return result;
}

// ─── Build agent identity card ────────────────────────────────────────────────

export interface AgentIdentityCard {
  agentId: string;
  solName: string;
  publicKey: string | null;
  reputationScore: number;
  verifiedStatus: string;
  taskTypes: string[];
  ratePer1kTokens: number;
}

/**
 * Get a full identity card for an agent, suitable for the marketplace
 * and agent profile display.
 */
export async function getAgentIdentityCard(
  agentId: string,
): Promise<AgentIdentityCard | null> {
  const { rows } = await query(
    `SELECT id, sol_name, public_key, reputation_score, verified_status,
            categories, default_rate_per_1k_tokens
     FROM agents WHERE id = $1`,
    [agentId],
  );

  if (rows.length === 0) return null;
  const agent = rows[0];

  const solName = agent.sol_name || (await getSolName(agentId));

  return {
    agentId: agent.id,
    solName,
    publicKey: agent.public_key,
    reputationScore: agent.reputation_score ?? 500,
    verifiedStatus: agent.verified_status ?? "unverified",
    taskTypes: agent.categories ? JSON.parse(agent.categories) : [],
    ratePer1kTokens: Number(agent.default_rate_per_1k_tokens),
  };
}
