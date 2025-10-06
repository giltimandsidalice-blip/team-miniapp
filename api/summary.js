// /api/summary.js
import { q } from "./_db";
import { llm } from "./_llm";
// If you don't have auth working yet, set SKIP_AUTH=true temporarily.
import { verifyTelegramInitData } from "./_tg";

const SYSTEM = "You are TRBE’s assistant. English only. Be concise. No PII.";
const SKIP_AUTH = false; // set to true only for quick isolation while debugging

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    // 1) AUTH
    try {
      const initData = req.headers["x-telegram-init-data"] || req.query.init_data || req.body?.init_data || "";
      if (!SKIP_AUTH) {
        const auth = verifyTelegramInitData ? verifyTelegramInitData(initData) : null;
        if (!auth) {
          return res.status(401).json({ error: "unauthorized (Telegram initData invalid or BOT_TOKEN missing)", stage: "auth" });
        }
      }
    } catch (e) {
      return res.status(401).json({ error: `auth_failed: ${e?.message || e}`, stage: "auth" });
    }

    // 2) INPUT
    const { chat_id, model } = req.query || {};
    if (!chat_id) return res.status(400).json({ error: "chat_id required", stage: "input" });

    // 3) DB FETCH
    let rows = [];
    try {
      const r = await q(
        `SELECT date, text FROM messages
         WHERE chat_id=$1 AND is_service=false AND text IS NOT NULL
         ORDER BY id DESC
         LIMIT 200`,
        [chat_id]
      );
      rows = r.rows || [];
    } catch (e) {
      return res.status(500).json({ error: `db_failed: ${e?.message || e}`, stage: "db" });
    }

    // 4) BUILD PROMPT
    const corpus = rows.map(r => `[${r.date}] ${r.text}`).join("\n").slice(0, 9000);
    const prompt =
`Summarize in 120–180 words.
- Goals
- Decisions
- Blockers
- Action items (bullet “Owner → Task → Due”)
- Sentiment (one line)
Translate RU→EN if needed.

Messages:
${corpus}`;

    // 5) LLM
    let text = "";
    try {
      text = await llm({ system: SYSTEM, user: prompt, max_tokens: 380, model });
    } catch (e) {
      const code = e.status || 502;
      return res.status(code).json({ error: e.message || "llm_failed", stage: "llm" });
    }

    return res.json({ text, model_used: model || process.env.OPENAI_MODEL || "gpt-4o-mini" });
  } catch (e) {
    // last-resort catcher: ensures JSON even on unexpected crashes
    return res.status(500).json({ error: e?.message || "summary_failed", stage: "unknown" });
  }
}
