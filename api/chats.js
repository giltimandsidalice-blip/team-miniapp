// api/chats.js
// Crash-proof: dynamic import DB, return JSON for every failure.

const SKIP_AUTH = true; // set false after testing

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // 1) DB import
  let q = null;
  try {
    const db = await import("./_db").catch(e => ({ __err: e }));
    if (db?.__err) throw db.__err;
    q = db.q;
    if (typeof q !== "function") throw new Error("q not exported from _db");
  } catch (e) {
    return res.status(500).json({ error: `import_db_failed: ${e?.message || e}`, stage: "import_db" });
  }

  // 2) (Optional) Telegram auth
  try {
    if (!SKIP_AUTH) {
      const tg = await import("./_tg").catch(()=>null);
      const verifyTelegramInitData = tg?.verifyTelegramInitData;
      if (!verifyTelegramInitData) {
        return res.status(500).json({ error: "verifyTelegramInitData not available", stage:"import_tg" });
      }
      const initData = req.headers["x-telegram-init-data"] || req.query.init_data || req.body?.init_data || "";
      const auth = verifyTelegramInitData(initData);
      if (!auth) return res.status(401).json({ error: "unauthorized", stage: "auth" });
    }
  } catch (e) {
    return res.status(401).json({ error: `auth_failed: ${e?.message||e}`, stage: "auth" });
  }

  // 3) Query chats
  try {
    const { rows } = await q(`
      SELECT id, title, username, is_megagroup, last_synced_at
      FROM chats
      ORDER BY last_synced_at DESC NULLS LAST, id DESC
      LIMIT 500
    `);
    return res.json(rows || []);
  } catch (e) {
    return res.status(500).json({ error: `db_failed: ${e?.message || e}`, stage:"db" });
  }
}
