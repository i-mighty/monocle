import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === "production";

// PRODUCTION REQUIREMENT: Database must be configured
if (!connectionString) {
  if (isProduction) {
    console.error("[FATAL] DATABASE_URL is required in production mode.");
    console.error("[FATAL] Mock mode is disabled in production.");
    throw new Error("DATABASE_URL environment variable is required in production");
  }
  console.warn("⚠️  DATABASE_URL not set. Using in-memory mock mode.");
  console.warn("⚠️  This is only allowed in development. Set NODE_ENV=production to enforce real database.");
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
    // Mock mode - ONLY allowed in development
    if (isProduction) {
      throw new Error("Database operations require DATABASE_URL in production");
    }
    console.log(`[MOCK] Query: ${text}`, params);
    return { rows: [], rowCount: 0 };
  }
  return pool.query(text, params);
};

// Re-export schema types for convenience
export * from "./schema";
