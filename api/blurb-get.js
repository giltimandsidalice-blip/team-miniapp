// api/blurb-get.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  try {
    const chatId = req.query.chat_id;
    if (!chatId) return res.status(400).json({ error: 'chat_id required' });

    // 1) Manual override?
    const over = await pool.query(
      `select blurb from project_meta where chat_id = $1`,
      [chatId]
    );
    if (over.rows[0]?.blurb) {
      return res.status(200).json({ blurb: over.rows[0].blurb, source: 'manual' });
    }

    // 2) Otherwise, best candidate from your view (latest by date)
    const cand = await pool.query(
      `select blurb, date
         from v_candidate_blurbs
        where chat_id = $1
        order by date desc
        limit 1`,
      [chatId]
    );
    if (cand.rows[0]?.blurb) {
      return res.status(200).json({ blurb: cand.rows[0].blurb, source: 'auto' });
    }

    res.status(200).json({ blurb: '', source: 'none' });
  } catch (e) {
    console.error('blurb-get error:', e);
    res.status(500).json({ error: 'server error' });
  }
};

