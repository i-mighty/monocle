import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("⚠️  DATABASE_URL not set. Using in-memory mock mode.");
}

// Raw pg pool for backward compatibility
export const pool = connectionString ? new pg.Pool({ connectionString }) : null;

// Drizzle ORM instance
export const db = pool
  ? drizzle(pool, { schema })
  : null;

/**
 * @deprecated Use `db` (Drizzle) for new code. This remains for backward compatibility.
 */
export const query = async (text: string, params?: any[]) => {
  if (!pool) {
    // Mock mode - return empty results for queries
    console.log(`[MOCK] Query: ${text}`, params);
    return { rows: [], rowCount: 0 };
  }
  return pool.query(text, params);
};

// Re-export schema types for convenience
export * from "./schema";
