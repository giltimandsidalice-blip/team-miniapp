// api/status.js
const { pool } = require('./_db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const chatId = req.query.chat_id;
      if (!chatId) return res.status(400).send('chat_id required');
      const { rows } = await pool.query(
        'select status, updated_at from chat_status where chat_id=$1',
        [chatId]
      );
      const r = rows[0] || { status: 'Talking', updated_at: null };
      return res.status(200).send(`${r.status} ${r.updated_at ? '· ' + r.updated_at : ''}`);
    }

    if (req.method === 'POST') {
      const { chat_id, status } = req.body || {};
      if (!chat_id || !status) return res.status(400).send('chat_id and status required');
      await pool.query(
        `insert into chat_status (chat_id, status, updated_at)
         values ($1,$2,now())
         on conflict (chat_id) do update set status=excluded.status, updated_at=now()`,
        [chat_id, status]
      );
      return res.status(200).send('Saved.');
    }

    res.status(405).send('Method not allowed');
  } catch (e) {
    console.error('status error:', e);
    res.status(500).send('SERVER ERROR');
  }
};
