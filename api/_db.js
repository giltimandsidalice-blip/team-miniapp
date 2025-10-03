// api/_db.js
const { Pool } = require('pg');

// strip any sslmode from the URL (node-postgres doesn't use it anyway)
const raw = process.env.DATABASE_URL || '';
const cleaned = raw.replace(/\?sslmode=\w+/, ''); // optional

const pool = new Pool({
  connectionString: cleaned,
  // The key part: don't verify the certificate chain
  ssl: { rejectUnauthorized: false },
});

module.exports = { pool };
