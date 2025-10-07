// api/company-blurb.js (ESM)
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
    if (!chatId) return res.status(400).json({ error: "chat_id required" });

    const { rows } = await q(
      `SELECT chat_id, id, date, sample, score
         FROM v_candidate_blurbs
        WHERE chat_id=$1
        ORDER BY score DESC, date DESC
        LIMIT 1`,
      [chatId]
    );

    if (!rows.length) {
      return res.status(200).json({ blurb: null, note: "no strong candidates found" });
    }
    return res.status(200).json({ blurb: rows[0].sample, score: rows[0].score, msg_id: rows[0].id });
  } catch (e) {
    console.error("company-blurb error:", e);
    res.status(500).json({ error: "server error" });
  }
}
