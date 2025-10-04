// Returns the best candidate blurb we can find for a chat
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// We assume you created the view v_candidate_blurbs as earlier.
module.exports = async (req, res) => {
  try {
    const chatId = req.query.chat_id;
    if (!chatId) return res.status(400).json({ error: 'chat_id required' });

    const { rows } = await pool.query(
      `select chat_id, id, date, sample, score
         from v_candidate_blurbs
        where chat_id = $1
        order by score desc, date desc
        limit 1`,
      [chatId]
    );

    if (!rows.length) {
      return res.status(200).json({ blurb: null, note: 'no strong candidates found' });
    }
    res.status(200).json({ blurb: rows[0].sample, score: rows[0].score, msg_id: rows[0].id });
  } catch (e) {
    console.error('company-blurb error:', e);
    res.status(500).json({ error: 'server error' });
  }
};

