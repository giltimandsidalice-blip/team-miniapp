// api/summary.js
const { pool } = require('./_db');

// Fallback summarizer
function fallbackSummary(messages) {
  const text = messages.map(m => m.text || '').join(' ');
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const freq = {};
  for (const w of words) if (w.length >= 4) freq[w] = (freq[w] || 0) + 1;
  const top = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([w])=>`• ${w}`);
  return { model: 'fallback', bullets: top, actions: [] };
}

async function fetchMessages(chatId, limit) {
  const { rows } = await pool.query(
    `select id, sender_id, date, text
     from messages
     where chat_id = $1 and text is not null
     order by date desc
     limit $2`,
    [chatId, limit]
  );
  return rows;
}

async function summarize(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  const content = messages
    .slice().reverse()
    .map(m => `[${m.date}] ${String(m.text || '').replace(/\s+/g,' ').slice(0,500)}`)
    .join('\n');

  if (!apiKey) return fallbackSummary(messages);

  const body = {
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content:
`Translate all content to English and summarize the chat updates.
Return:
1) 4–6 concise bullet points (decisions, blockers, asks).
2) Action items with owners if mentioned.
3) Risks/unknowns.
Make the output in English only.

Chat (latest last):
${content}`
    }],
    temperature: 0.2
  };

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) return fallbackSummary(messages);
    return { model: 'openai', text };
  } catch (e) {
    console.error('openai error', e);
    return fallbackSummary(messages);
  }
}

module.exports = async (req, res) => {
  try {
    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit || '120', 10), 300);
    if (!chatId) return res.status(400).json({ error: 'chat_id required' });

    const msgs = await fetchMessages(chatId, limit);
    const result = await summarize(msgs);
    res.status(200).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
};
