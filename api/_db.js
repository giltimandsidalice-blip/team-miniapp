// api/_db.js
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL missing');
}

// Parse DATABASE_URL and pass explicit fields so nothing can override them
const u = new URL(process.env.DATABASE_URL);

const cfg = {
  user: decodeURIComponent(u.username),        // e.g. "postgres.bbvvaqokstsccholednn"
  password: decodeURIComponent(u.password),    // your DB password
  host: u.hostname,                            // aws-1-ap-southeast-2.pooler.supabase.com
  port: Number(u.port || 5432),
  database: u.pathname.replace(/^\//, ''),     // "postgres"
  ssl: { rejectUnauthorized: false },          // accept Supabase pooler chain
};

// Helpful log (safe — no password)
console.log('[db] user=', cfg.user, 'host=', cfg.host, 'db=', cfg.database);

const pool = new Pool(cfg);
module.exports = { pool };
