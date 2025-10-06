// /api/summary.js
import { q } from "./_db";
import { llm } from "./_llm";
import { verifyTelegramInitData } from "./_tg";

const SYSTEM = "You are TRBE’s internal assistant. English only. No PII.";

export default async function handler(req, res) {
  try {
    // Auth (if you don’t have BOT_TOKEN set yet, temporarily bypass for testing)
    const initData = req.headers["x-telegram-init-data"] || req.query.init_data || req.body?.init_data || "";
    const auth = verifyTelegramInitData ? verifyTelegramInitData(initData) : { user: null };
    if (!auth) return res.status(401).json({ error: "unauthorized (Telegram initData invalid or BOT_TOKEN missing)" });

    const { chat_id, model } = req.query || {};
    if (!chat_id) return res.status(400).json({ error: "chat_id required" });

    // OPTIONAL: comment out cache while debugging
    // const cached = await q(...); if (cached) return res.json({ text: cached.text, cached: true });

    const { rows: msgs } = await q(`
      SELECT date, text FROM messages
      WHERE chat_id=$1 AND is_service=false AND text IS NOT NULL
      ORDER BY id DESC
      LIMIT 200
    `, [chat_id]);

    const corpus = msgs.map(m => `[${m.date}] ${m.text}`).join("\n").slice(0, 9000);
    const prompt =
`Summarize the last messages for this chat in 120–180 words.
Cover: Goals, Decisions, Blockers, Action items, Sentiment (one line).
Translate RU→EN if needed.

Messages:
${corpus}`;

    const text = await llm({ system: SYSTEM, user: prompt, max_tokens: 380, model });
    return res.json({ text, cached: false, model_used: model || process.env.OPENAI_MODEL || "gpt-4o-mini" });
  } catch (e) {
    const code = e.status || 500;
    return res.status(code).json({ error: e.message || "summary_failed" });
  }
}
