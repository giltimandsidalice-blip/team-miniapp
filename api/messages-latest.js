// api/messages-latest.js (ESM)
import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";

const SKIP_AUTH = false;

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
    return res.status(401).json({ error:`auth_failed: ${e?.message||e}`, stage:"auth" });
  }

  try {
    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 1000);
    if (!chatId) return res.status(400).json({ error: "chat_id required" });

    const { rows } = await q(
      `SELECT id, sender_id, date, text, reply_to_msg_id
         FROM messages
        WHERE chat_id=$1
        ORDER BY date DESC
        LIMIT $2`,
      [chatId, limit]
    );
    res.status(200).json(rows);
  } catch (e) {
    console.error("messages-latest error:", e);
    res.status(500).json({ error: "DB error" });
  }
}
