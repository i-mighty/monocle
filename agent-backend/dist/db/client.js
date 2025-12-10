import pg from "pg";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.warn("⚠️  DATABASE_URL not set. Using in-memory mock mode.");
}
export const pool = connectionString ? new pg.Pool({ connectionString }) : null;
export const query = async (text, params) => {
    if (!pool) {
        // Mock mode - return empty results for queries
        console.log(`[MOCK] Query: ${text}`, params);
        return { rows: [], rowCount: 0 };
    }
    return pool.query(text, params);
};
