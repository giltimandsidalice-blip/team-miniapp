// api/_db.js
import pkg from "pg";
const { Pool } = pkg;

const rawConnectionString = process.env.DATABASE_URL;
if (!rawConnectionString || !String(rawConnectionString).trim()) {
  throw new Error("[db] DATABASE_URL is missing");
  
}

const connectionString = String(rawConnectionString).trim();
if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
  throw new Error("[db] DATABASE_URL must be a Postgres connection string");
}
/**
 * If you have a proper CA cert, paste it into Vercel as SUPABASE_CA and we'll verify.
 * Otherwise, we fall back to rejectUnauthorized:false to handle self-signed chains.
 */
const ca = (() => {
  const raw = process.env.SUPABASE_CA;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed ? trimmed : null;
})();
export const pool = new Pool({
  connectionString,
  ssl: ca ? { ca } : { rejectUnauthorized: false }
});

export const q = (sql, params = []) => pool.query(sql, params);
