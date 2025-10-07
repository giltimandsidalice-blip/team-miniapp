// api/status.js (ESM) — manual overrides (GET/POST)
import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";

const SKIP_AUTH = false; // set true briefly only if debugging

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    if (!SKIP_AUTH) {
      const initData = req.headers["x-telegram-init-data"] || req.query.init_data || req.body?.init_data || "";
      const ok = verifyTelegramInitData(initData);
      if (!ok) return res.status(401).json({ error: "unauthorized" });
    }
  } catch (e) {
    return res.status(401).json({ error: `auth_failed: ${e?.message || e}` });
  }

  try {
    if (req.method === "GET") {
      const chatId = req.query.chat_id;
      if (!chatId) return res.status(400).json({ error: "chat_id required" });
      const r = await q(`select status, updated_at from chat_status where chat_id=$1`, [chatId]);
      const row = r.rows[0] || null;
      return res.status(200).json({ chat_id: chatId, status: row?.status || null, updated_at: row?.updated_at || null });
    }

    if (req.method === "POST") {
      const { chat_id, status } = req.body || {};
      if (!chat_id || !status) return res.status(400).json({ error: "chat_id and status required" });

      await q(
        `insert into chat_status (chat_id, status, updated_at)
         values ($1,$2,now())
         on conflict (chat_id) do update set status=excluded.status, updated_at=now()`,
        [chat_id, status]
      );
      return res.status(200).send("Saved.");
    }

    res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    console.error("status error:", e);
    res.status(500).json({ error: "server_error" });
  }
}
