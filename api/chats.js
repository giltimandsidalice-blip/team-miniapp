// api/chats.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
module.exports = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "select id, title, coalesce(username,'') as username from chats order by title asc limit 200"
    );
    res.status(200).json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
};
