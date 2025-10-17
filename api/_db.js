// api/_db.js
import pkg from "pg";
const { Pool } = pkg;

function resolveConnectionString() {
  const candidates = [
    { env: "DATABASE_URL", value: process.env.DATABASE_URL },
    { env: "SUPABASE_DB_URL", value: process.env.SUPABASE_DB_URL },
    { env: "SUPABASE_POSTGRES_URL", value: process.env.SUPABASE_POSTGRES_URL },
    { env: "SUPABASE_CONNECTION_STRING", value: process.env.SUPABASE_CONNECTION_STRING },
    { env: "POSTGRES_URL", value: process.env.POSTGRES_URL },
    { env: "PG_DATABASE_URL", value: process.env.PG_DATABASE_URL },
  ];

  for (const { env, value } of candidates) {
    if (value && String(value).trim()) {
      if (env !== "DATABASE_URL") {
        console.info(`[db] Using ${env} for database connection string.`);
      }
      return String(value).trim();
    }
  }

  console.error(
    "[db] No database connection string found. Expected one of DATABASE_URL, " +
      "SUPABASE_DB_URL, SUPABASE_POSTGRES_URL, SUPABASE_CONNECTION_STRING, " +
      "POSTGRES_URL, PG_DATABASE_URL."
  );
  throw new Error("DATABASE_URL is missing");
}

const connectionString = resolveConnectionString();

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
