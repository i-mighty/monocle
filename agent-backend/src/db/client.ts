import pg from "pg";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const query = (text: string, params?: any[]) => pool.query(text, params);

