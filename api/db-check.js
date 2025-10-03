// api/_db.js
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL missing');
}

// Parse the URL so we *explicitly* pass user/host/db to pg (avoids PGUSER overrides)
const u = new URL(process.env.DATABASE_URL);

// Note: URL parser decodes %24 → $ automatically (that’s OK)
const config = {
  user: decodeURIComponent(u.username),       // e.g. "postgres.bbvvaqokstsccholednn"
  password: decodeURIComponent(u.password),   // e.g. "thisisthemostbeautifulw$ifulworld"
  host: u.hostname,                           // e.g. "aws-1-ap-southeast-2.pooler.supabase.com"
  port: Number(u.port || 5432),
  database: u.pathname.replace(/^\//, ''),    // "postgres"
  ssl: { rejectUnauthorized: false },         // supabase pooled often needs no-verify
};

// Helpful startup log (mask password)
console.log('[db] user=', config.user, 'host=', config.host, 'db=', config.database);

const pool = new Pool(config);
module.exports = { pool };
