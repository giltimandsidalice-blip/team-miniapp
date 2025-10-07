// api/chats.js
// Returns chats + current status + sow_days for dashboard.

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // DB import
  let q = null;
  try {
    const db = await import("./_db.js").catch(e => ({ __err: e }));
    if (db?.__err) throw db.__err;
    q = db.q;
    if (typeof q !== "function") throw new Error("q not exported from _db");
  } catch (e) {
    return res.status(500).json({ error: `import_db_failed: ${e?.message || e}`, stage: "import_db" });
  }

  try {
    const { rows } = await q(`
      SELECT
        c.id, c.title, c.username, c.is_megagroup, c.last_synced_at,
        s.status,
        CASE
          WHEN s.status = 'SoW signed' AND s.updated_at IS NOT NULL
          THEN FLOOR(EXTRACT(EPOCH FROM (now() - s.updated_at))/86400)::int
          ELSE NULL
        END AS sow_days
      FROM chats c
      LEFT JOIN chat_status s ON s.chat_id = c.id
      ORDER BY c.last_synced_at DESC NULLS LAST, c.id DESC
      LIMIT 1000
    `);
    return res.json(rows || []);
  } catch (e) {
    return res.status(500).json({ error: `db_failed: ${e?.message || e}`, stage:"db" });
  }
}
