// api/_db.js
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL missing');
}

// Parse the URL and pass explicit fields so env overrides (PGUSER, etc.) can't hijack it.
const u = new URL(process.env.DATABASE_URL);

// If you ever decide to use username "postgres" + options=project=<ref>, this keeps it:
const cfg = {
  user: decodeURIComponent(u.username),        // e.g. "postgres.bbvvaqokstsccholednn"
  password: decodeURIComponent(u.password),    // your DB password
  host: u.hostname,                            // aws-1-ap-southeast-2.pooler.supabase.com
  port: Number(u.port || 5432),
  database: u.pathname.replace(/^\//, ''),     // "postgres"
  ssl: { rejectUnauthorized: false },          // supabase pooler cert chain
};

// Helpful log in Vercel logs (safe, no password)
console.log('[db] user=', cfg.user, 'host=', cfg.host, 'db=', cfg.database);

const pool = new Pool(cfg);
module.exports = { pool };
