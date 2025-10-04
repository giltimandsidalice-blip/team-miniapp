// api/chats.js
const { pool } = require('./_db');

module.exports = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q) {
      const { rows } = await pool.query(
        `select id, title, coalesce(username,'') as username
           from chats
          where title ilike $1 or cast(id as text) ilike $1
          order by title asc
          limit 200`,
        [`%${q}%`]
      );
      return res.status(200).json(rows);
    }

    const { rows } = await pool.query(
      `select id, title, coalesce(username,'') as username
         from chats
         order by title asc
         limit 200`
    );
    res.status(200).json(rows);
  } catch (e) {
    console.error('chats error:', e);
    res.status(500).send(`SERVER ERROR: ${e?.message || e}`);
  }
};
