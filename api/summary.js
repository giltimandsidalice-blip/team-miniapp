// api/summary.js (FINAL, better fallback if few msgs)

const SYSTEM = "You are TRBE’s assistant. English only. Be concise. No PII.";
const SKIP_AUTH = false;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  let q = null, llm = null;
  try {
    const db = await import("./_db.js");
    q = db.q;
  } catch (e) {
    return res.status(500).json({ error: `import_db_failed: ${e?.message || e}`, stage: "import_db" });
  }

  try {
    if (!SKIP_AUTH) {
      const tg = await import("./_tg.js").catch(() => null);
      const verifyTelegramInitData = tg?.verifyTelegramInitData;
      if (!verifyTelegramInitData) return res.status(500).json({ error: "verifyTelegramInitData not available", stage: "import_tg" });
      const initData = req.headers["x-telegram-init-data"] || req.query.init_data || req.body?.init_data || "";
      const auth = verifyTelegramInitData(initData);
      if (!auth) return res.status(401).json({ error: "unauthorized (bad initData / missing BOT_TOKEN)", stage: "auth" });
    }
  } catch (e) {
    return res.status(401).json({ error: `auth_failed: ${e?.message || e}`, stage: "auth" });
  }

  const { chat_id, model } = req.query || {};
  if (!chat_id) return res.status(400).json({ error: "chat_id required", stage: "input" });

  // Primary query (non-service, w/ text)
  let rows = [];
  try {
    const r = await q(
      `SELECT date, text
         FROM messages
        WHERE chat_id=$1 AND is_service=false AND text IS NOT NULL
        ORDER BY date DESC
        LIMIT 400`,
      [chat_id]
    );
    rows = r?.rows || [];
  } catch (e) {
    return res.status(500).json({ error: `db_failed: ${e?.message || e}`, stage: "db" });
  }

  // Fallback: allow messages where is_service is null/false and strip empties
  if (!rows.length) {
    try {
      const r2 = await q(
        `SELECT date, text
           FROM messages
          WHERE chat_id=$1 AND text IS NOT NULL
          ORDER BY date DESC
          LIMIT 400`,
        [chat_id]
      );
      rows = (r2?.rows || []).filter(r => (r.text||'').trim().length>0);
    } catch {}
  }

  if (!rows.length) {
    return res.json({ text: "No recent messages in this chat." });
  }

  const corpus = rows.map(r => `[${r.date}] ${r.text}`).join("\n").slice(0, 9000);
  const prompt = `Summarize in 120–180 words.
- Goals
- Decisions
- Blockers
- Action items (bullet “Owner → Task → Due”)
- Sentiment (one line)
Translate RU→EN if needed.

Messages:
${corpus}`;

  try {
    const mod = await import("./_llm.js");
    llm = mod.llm;
  } catch (e) {
    return res.status(500).json({ error: `import_llm_failed: ${e?.message || e}`, stage: "import_llm" });
  }

  try {
    const text = await llm({ system: SYSTEM, user: prompt, max_tokens: 380, model });
    return res.json({ text, model_used: model || process.env.OPENAI_MODEL || "gpt-4o-mini" });
  } catch (e) {
    const code = e?.status || 502;
    return res.status(code).json({ error: e?.message || "llm_failed", stage: "llm" });
  }
}
