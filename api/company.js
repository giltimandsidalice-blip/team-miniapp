// api/company.js (ESM)
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
        `SELECT blurb FROM company_blurbs WHERE chat_id=$1`,
        [chatId]
      );
      return res.status(200).json({ blurb: rows[0]?.blurb || "" });
    }

    if (req.method === "POST") {
      const { chat_id, blurb } = req.body || {};
      if (!chat_id) return res.status(400).json({ error: "chat_id required" });
      await q(
        `INSERT INTO company_blurbs (chat_id, blurb, updated_at)
         VALUES ($1,$2,now())
         ON CONFLICT (chat_id) DO UPDATE SET blurb=excluded.blurb, updated_at=now()`,
        [chat_id, blurb || null]
      );
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("company error:", e);
    res.status(500).json({ error: "server error" });
  }
}
