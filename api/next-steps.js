// api/next-steps.js
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

module.exports = async (req, res) => {
  try {
    const chatId = req.query.chat_id;
    const limit  = Math.min(parseInt(req.query.limit || '120', 10), 300);
    if (!chatId) return res.status(400).json({ error: 'chat_id required' });

    const msgs = await fetchMessages(chatId, limit);
    if (!msgs.length) return res.status(200).json({ text: 'No recent messages.' });

    const snippets = msgs.map(m => `[${m.date}] ${String(m.text||'').replace(/\s+/g,' ').slice(0,300)}`);
    const clean = scrubPII(snippets.join('\n'));

    const system = 'You are Kiara, an ops AI for TRBE. Be direct, English-only, and pragmatic.';
    const user =
`From the chat context, propose the next steps for the TRBE team.

Format:
- 3–6 prioritized action items (Owner → action; deadline if implied)
- 1 short risk/unknowns line (if any)
- 1 “quick win” (small task to do today)

Context (latest first):
${clean}`;

    const text = await chatComplete({ system, user, model: 'gpt-4o-mini', temperature: 0.2 });
    res.status(200).json({ model: 'gpt-4o-mini', text });
  } catch (e) {
    console.error('next-steps error:', e);
    res.status(500).json({ error: 'server error' });
  }
};
