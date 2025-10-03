// api/company.js
const { pool } = require('./_db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const chatId = req.query.chat_id;
      if (!chatId) return res.status(400).send('chat_id required');
      const { rows } = await pool.query(
        'select blurb from company_blurbs where chat_id=$1',
        [chatId]
      );
      return res.status(200).send(rows[0]?.blurb || '(no blurb)');
    }

    if (req.method === 'POST') {
      const { chat_id, blurb } = req.body || {};
      if (!chat_id) return res.status(400).send('chat_id required');
      await pool.query(
        `insert into company_blurbs (chat_id, blurb, updated_at)
         values ($1,$2,now())
         on conflict (chat_id) do update set blurb=excluded.blurb, updated_at=now()`,
        [chat_id, blurb || null]
      );
      return res.status(200).send('Saved.');
    }

    res.status(405).send('Method not allowed');
  } catch (e) {
    console.error('company error:', e);
    res.status(500).send('SERVER ERROR');
  }
};
