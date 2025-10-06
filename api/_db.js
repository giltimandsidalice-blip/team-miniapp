// api/_db.js
// Minimal Postgres helper for Vercel functions (ESM)

import pkg from "pg";
const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Throw here so callers see a clear error instead of a silent crash
  throw new Error("DATABASE_URL is missing");
}

export const pool = new Pool({
  connectionString,
  // Supabase pooled connections usually require SSL
  ssl: { rejectUnauthorized: true }
});

/** q(text, params) -> rows */
export const q = (text, params = []) => pool.query(text, params);
