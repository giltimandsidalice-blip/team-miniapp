// api/db-check.js
const { pool } = require('./_db');

module.exports = async (_req, res) => {
  try {
    await pool.query('select 1');
    const info = await pool.query(`select current_database() as db, current_user as usr, now() as ts`);
    const tables = await pool.query(`
      select table_name
      from information_schema.tables
      where table_schema='public' and table_name in ('chats','messages','tg_users','chat_acl')
      order by table_name
    `);
    res.status(200).json({ info: info.rows[0], tables: tables.rows });
  } catch (e) {
    res.status(500).send(`SERVER ERROR: ${e?.message || e}`);
  }
};
