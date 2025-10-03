// api/db-check.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
function log(...a){ console.log(new Date().toISOString(), '[db-check]', ...a); }

module.exports = async (_req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).send('SERVER ERROR: DATABASE_URL missing');
    log('start');
    await pool.query('select 1');                                  log('select 1 ok');
    const info = await pool.query(`select current_database() db, current_user usr, now() ts`); log('info ok');
    const tables = await pool.query(`
      select table_name
      from information_schema.tables
      where table_schema='public' and table_name in ('chats','messages','tg_users','chat_acl')
      order by table_name
    `);                                                             log('tables ok');
    res.status(200).json({ info: info.rows[0], tables: tables.rows });
  } catch (e) {
    log('ERROR:', e?.message || e);
    res.status(500).send(`SERVER ERROR: ${e?.message || e}`);
  }
};
