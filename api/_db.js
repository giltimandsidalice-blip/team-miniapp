// api/_db.js
import pkg from "pg";
const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is missing");

/**
 * If you have a proper CA cert, paste it into Vercel as SUPABASE_CA and we'll verify.
 * Otherwise, we fall back to rejectUnauthorized:false to handle self-signed chains.
 */
const ca = process.env.SUPABASE_CA || process.env.DB_CA || null;

export const pool = new Pool({
  connectionString,
  ssl: ca ? { ca } : { rejectUnauthorized: false }
});

export const q = (sql, params = []) => pool.query(sql, params);
