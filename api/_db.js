// api/_db.js
// Postgres helper for Vercel (ESM) with SSL that won't break on self-signed chains.

import pkg from "pg";
const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

/**
 * If you have a proper CA cert, paste it into Vercel as SUPABASE_CA and
 * we'll verify. Otherwise, we fall back to rejectUnauthorized:false,
 * which fixes the “self-signed certificate in certificate chain” error.
 */
const ca = process.env.SUPABASE_CA || process.env.DB_CA || null;

export const pool = new Pool({
  connectionString,
  ssl: ca
    ? { ca }                               // strict verify using provided CA
    : { rejectUnauthorized: false }        // quick fix for self-signed chains
});

export const q = (sql, params = []) => pool.query(sql, params);
