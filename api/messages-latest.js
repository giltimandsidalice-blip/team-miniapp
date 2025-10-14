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
    const limit = Math.min(Math.max(parseInt(req.query.limit || "200", 10), 1), 1000);
    if (!chatId) return res.status(400).json({ error: "chat_id required" });

    const sinceRaw = req.query.since;
    let sinceIso = null;
    if (sinceRaw) {
      const parsed = new Date(sinceRaw);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "invalid_since" });
      }
      sinceIso = parsed.toISOString();
    }

    const sources = [
      { name: "v_messages_non_team", skipOnMissing: true, extraFilter: "" },
      { name: "messages", skipOnMissing: false, extraFilter: "COALESCE(is_service,false) = false" },
    ];

    for (const source of sources) {
      try {
        const clauses = ["chat_id = $1"];
        const params = [chatId];

        if (sinceIso) {
          params.push(sinceIso);
          clauses.push(`date > $${params.length}`);
        }

        if (source.extraFilter) {
          clauses.push(source.extraFilter);
        }

        params.push(limit);
        const limitIdx = params.length;

        const sql = `
          SELECT id, sender_id, date, text, reply_to_msg_id
            FROM ${source.name}
           WHERE ${clauses.join(" AND ")}
           ORDER BY date DESC
           LIMIT $${limitIdx}`;

        const { rows } = await q(sql, params);
        return res.status(200).json(rows || []);
      } catch (e) {
        if (source.skipOnMissing && (e?.code === "42P01" || /does not exist/i.test(e?.message || ""))) {
          continue;
        }
        console.error("messages-latest error:", e);
        return res.status(500).json({ error: "DB error" });
      }
    }

    return res.status(500).json({ error: "DB error" });
  } catch (e) {
    console.error("messages-latest error:", e);
    res.status(500).json({ error: "DB error" });
  }
}
