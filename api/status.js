// api/status.js (ESM, idempotent table creation + upsert)
import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";

const SKIP_AUTH = false;

async function ensureTable() {
  await q(`
    create table if not exists chat_status (
      chat_id    bigint primary key,
      status     text not null,
      updated_at timestamptz not null default now()
    );
  `);
}

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
    await ensureTable();

    if (req.method === "GET") {
      const chatId = req.query.chat_id;
      if (!chatId) return res.status(400).json({ error: "chat_id required" });
      const { rows } = await q(
        `select status, updated_at from chat_status where chat_id = $1`,
        [chatId]
      );
      const r = rows[0] || null;
      return res.status(200).json(r ?? { status: null, updated_at: null });
    }

    if (req.method === "POST") {
      const { chat_id, status } = req.body || {};
      if (!chat_id || !status) return res.status(400).json({ error: "chat_id and status required" });
      await q(
        `insert into chat_status (chat_id, status, updated_at)
         values ($1, $2, now())
         on conflict (chat_id)
         do update set status = excluded.status, updated_at = now()`,
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
