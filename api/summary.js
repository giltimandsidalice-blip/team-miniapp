// api/summary.js
const { Pool } = require('pg');
const { scrubPII, chatComplete } = require('./_llm');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function fetchMessages(chatId, limit) {
  const { rows } = await pool.query(
    `select date, text from messages
     where chat_id=$1 and text is not null
     order by date desc limit $2`,
    [chatId, limit]
  );
  return rows;
}

async function getCached(chatId, day) {
  const { rows } = await pool.query(
    `select model, text from summaries_cache where chat_id=$1 and day=$2`,
    [chatId, day]
  );
  return rows[0] || null;
}

async function putCache(chatId, day, model, text) {
  await pool.query(
    `insert into summaries_cache (chat_id, day, model, text)
     values ($1,$2,$3,$4)
     on conflict (chat_id,day) do update set model=excluded.model, text=excluded.text`,
    [chatId, day, model, text]
  );
}

module.exports = async (req, res) => {
  try {
    const chatId = req.query.chat_id;
    const limit  = Math.min(parseInt(req.query.limit || '160', 10), 400);
    const bypass = req.query.bypass_cache === '1';
    if (!chatId) return res.status(400).json({ error: 'chat_id required' });

    const today = new Date().toISOString().slice(0,10);
    if (!bypass) {
      const cached = await getCached(chatId, today);
      if (cached?.text) return res.status(200).json(cached);
    }

    const msgs = await fetchMessages(chatId, limit);
    if (!msgs.length) return res.status(200).json({ model: 'none', text: 'No recent messages.' });

    const snippets = msgs.map(m => `[${m.date}] ${String(m.text||'').replace(/\s+/g,' ').slice(0,400)}`);
    const clean = scrubPII(snippets.join('\n'));

    const system = 'You are an operations assistant for a Web3 agency. Be concise, actionable, and English-only.';
    const user =
`Summarize the chat for TRBE.

Return:
1) 4–6 concise bullet points (decisions, blockers, asks).
2) Action items with owners if mentioned.
3) Risks/unknowns.

Snippets (latest first):
${clean}`;

    const text = await chatComplete({ system, user, model: 'gpt-4o-mini', temperature: 0.2 });
    await putCache(chatId, today, 'gpt-4o-mini', text);
    res.status(200).json({ model: 'gpt-4o-mini', text });
  } catch (e) {
    console.error('summary error:', e);
    res.status(200).json({ model: 'fallback', text: '(fallback) AI temporarily unavailable.' });
  }
};
