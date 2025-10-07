// api/next-steps.js (ESM)
import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";
import { chatComplete, scrubPII } from "./_llm.js";

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
    const limit  = Math.min(parseInt(req.query.limit || "120", 10), 300);
    if (!chatId) return res.status(400).json({ error: "chat_id required" });

    const r = await q(
      `SELECT date, text FROM messages
        WHERE chat_id=$1 AND text IS NOT NULL
        ORDER BY date DESC
        LIMIT $2`,
      [chatId, limit]
    );
    const msgs = r?.rows || [];
    if (!msgs.length) return res.status(200).json({ text: "No recent messages." });

    const snippets = msgs.map(m => `[${m.date}] ${String(m.text||"").replace(/\s+/g," ").slice(0,300)}`);
    const clean = scrubPII(snippets.join("\n"));

    const system = "You are Kiara, an ops AI for TRBE. Be direct, English-only, and pragmatic.";
    const user =
`From the chat context, propose the next steps for the TRBE team.

Format:
- 3–6 prioritized action items (Owner → action; deadline if implied)
- 1 short risk/unknowns line (if any)
- 1 “quick win” (small task to do today)

Context (latest first):
${clean}`;

    const text = await chatComplete({ system, user, model: "gpt-4o-mini", temperature: 0.2 });
    res.status(200).json({ model: "gpt-4o-mini", text });
  } catch (e) {
    console.error("next-steps error:", e);
    res.status(500).json({ error: "server error" });
  }
}
