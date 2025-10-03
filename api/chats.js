// api/chats.js
const { pool } = require('./_db');

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms));
function log(...a){ console.log(new Date().toISOString(), '[chats]', ...a); }

module.exports = async (_req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).send('SERVER ERROR: DATABASE_URL missing');

    log('start');
    await Promise.race([pool.query('select 1'), timeout(5000)]);   log('select 1 ok');

    const q = `
      select id, title, coalesce(username,'') as username
      from chats
      order by title asc
      limit 200
    `;
    const { rows } = await Promise.race([pool.query(q), timeout(7000)]);
    log('query ok, rows =', rows.length);

    res.status(200).json(rows);
  } catch (e) {
    log('ERROR:', e?.message || e);
    res.status(500).send(`SERVER ERROR: ${e?.message || e}`);
  }
};
