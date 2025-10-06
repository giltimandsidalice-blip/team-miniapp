// api/summary.js
// Final, crash-proof version for production (ESM). Uses dynamic imports with .js extensions.
// Toggle SKIP_AUTH to true only while debugging locally.

const SYSTEM = "You are TRBE’s assistant. English only. Be concise. No PII.";
const SKIP_AUTH = false; // set to true temporarily for debugging, then back to false

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // 0) Dynamic imports (avoid top-level crashes)
  let q = null;
  try {
    const db = await import("./_db.js").catch(e => ({ __err: e }));
    if (db?.__err) throw db.__err;
    if (typeof db.q !== "function") throw new Error("q not exported from _db.js");
    q = db.q;
  } catch (e) {
    return res.status(500).json({ error: `import_db_failed: ${e?.message || e}`, stage: "import_db" });
  }

  // Optional Telegram auth (enabled when SKIP_AUTH === false)
  try {
    if (!SKIP_AUTH) {
      const tg = await import("./_tg.js").catch(() => null);
      const verifyTelegramInitData = tg?.verifyTelegramInitData;
      if (!verifyTelegramInitData) {
        return res.status(500).json({ error: "verifyTelegramInitData not available", stage: "import_tg" });
      }
      const initData =
        req.headers["x-telegram-init-data"] ||
        req.query.init_data ||
        req.body?.init_data ||
        "";
      const auth = verifyTelegramInitData(initData);
      if (!auth) {
        return res.status(401).json({
          error: "unauthorized (bad initData / missing BOT_TOKEN)",
          stage: "auth"
        });
      }
    }
  } catch (e) {
    return res.status(401).json({ error: `auth_failed: ${e?.message || e}`, stage: "auth" });
  }

  // 1) Inputs
  const { chat_id, model } = req.query || {};
  if (!chat_id) {
    return res.status(400).json({ error: "chat_id required", stage: "input" });
  }

  // 2) Fetch recent messages
  let rows = [];
  try {
    const r = await q(
      `SELECT date, text
       FROM messages
       WHERE chat_id=$1 AND is_service=false AND text IS NOT NULL
       ORDER BY id DESC
       LIMIT 200`,
      [chat_id]
    );
    rows = r?.rows || [];
  } catch (e) {
    return res.status(500).json({ error: `db_failed: ${e?.message || e}`, stage: "db" });
  }

  if (!rows.length) {
    return res.json({ text: "No recent messages in this chat." });
  }

  // 3) Build prompt
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

  // 4) LLM call
  let llm = null;
  try {
    const mod = await import("./_llm.js").catch(e => ({ __err: e }));
    if (mod?.__err) throw mod.__err;
    if (typeof mod.llm !== "function") throw new Error("llm not exported from _llm.js");
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

