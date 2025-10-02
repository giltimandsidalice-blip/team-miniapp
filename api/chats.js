// api/chats.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function log(...a){ console.log(new Date().toISOString(), '[chats]', ...a); }

module.exports = async (_req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).send('SERVER ERROR: DATABASE_URL missing');
    }
    log('start');
    // quick connectivity check (if bad URL/creds, this will throw)
    await pool.query('select 1');
    log('select 1 ok');

    const q = `
      select id, title, coalesce(username,'') as username
      from chats
      order by title asc
      limit 200
    `;
    const { rows } = await pool.query(q);
    log('query ok, rows =', rows.length);
    res.status(200).json(rows);
  } catch (e) {
    log('ERROR:', e?.message || e);
    res.status(500).send(`SERVER ERROR: ${e?.message || e}`);
  }
};
