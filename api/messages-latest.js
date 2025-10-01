// api/messages-latest.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
module.exports = async (req, res) => {
  try {
    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    if (!chatId) return res.status(400).json({ error: 'chat_id required' });

    const { rows } = await pool.query(
      `select id, sender_id, date, text, reply_to_msg_id
       from messages
       where chat_id = $1
       order by date desc
       limit $2`,
      [chatId, limit]
    );
    res.status(200).json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
};
