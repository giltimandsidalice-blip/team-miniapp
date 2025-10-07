// api/status.js (ESM)
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
    if (req.method === "GET") {
      const chatId = req.query.chat_id;
      if (!chatId) return res.status(400).json({ error: "chat_id required" });
      const { rows } = await q(
        `SELECT status, updated_at FROM chat_status WHERE chat_id=$1`,
        [chatId]
      );
      const r = rows[0] || { status: "Talking stage", updated_at: null };
      return res.status(200).json(r);
    }

    if (req.method === "POST") {
      const { chat_id, status } = req.body || {};
      if (!chat_id || !status) return res.status(400).json({ error: "chat_id and status required" });
      await q(
        `INSERT INTO chat_status (chat_id, status, updated_at)
         VALUES ($1,$2,now())
         ON CONFLICT (chat_id)
         DO UPDATE SET status=excluded.status, updated_at=now()`,
        [chat_id, status]
      );
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("status error:", e);
    res.status(500).json({ error: "server error" });
  }
}
