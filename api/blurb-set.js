// api/blurb-set.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const { chat_id, blurb } = req.body || {};
    if (!chat_id) return res.status(400).json({ error: 'chat_id required' });

    await pool.query(
      `insert into project_meta (chat_id, blurb, updated_at)
       values ($1, $2, now())
       on conflict (chat_id) do update
         set blurb = excluded.blurb,
             updated_at = now()`,
      [chat_id, blurb || '']
    );
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('blurb-set error:', e);
    res.status(500).json({ error: 'server error' });
  }
};

