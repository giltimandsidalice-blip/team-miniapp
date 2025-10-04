// api/status-set.js
const { Pool } = require('pg');

const ALLOWED = new Set([
  'Talking stage',
  'Awaiting SoW',
  'SoW signed',
  'Preparing campaign',
  'Campaign live',
  'Awaiting report',
  'Campaign finished'
]);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const { chat_id, status } = req.body || {};
    if (!chat_id) return res.status(400).json({ error: 'chat_id required' });
    if (!ALLOWED.has(status)) return res.status(400).json({ error: 'invalid status' });

    await pool.query(
      `insert into project_meta (chat_id, status_manual, updated_at)
       values ($1, $2, now())
       on conflict (chat_id) do update
         set status_manual = excluded.status_manual,
             updated_at = now()`,
      [chat_id, status]
    );
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('status-set error:', e);
    res.status(500).json({ error: 'server error' });
  }
};
