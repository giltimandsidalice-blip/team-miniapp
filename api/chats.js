// api/chats.js (ESM)
import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";

const SKIP_AUTH = false; // set true only while debugging

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    if (!SKIP_AUTH) {
      const initData =
        req.headers["x-telegram-init-data"] ||
        req.query.init_data ||
        req.body?.init_data ||
        "";
      const ok = verifyTelegramInitData(initData);
      if (!ok) return res.status(401).json({ error: "unauthorized", stage: "auth" });
    }
  } catch (e) {
    return res.status(401).json({ error: `auth_failed: ${e?.message || e}`, stage: "auth" });
  }

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
