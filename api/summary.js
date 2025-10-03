// api/summary.js
const { pool } = require('./_db');

// very simple fallback summarizer (works even without OpenAI)
function fallbackSummary(messages) {
  const text = messages.map(m => m.text || '').join(' ');
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const freq = {};
  for (const w of words) if (w.length >= 4) freq[w] = (freq[w] || 0) + 1;
  const top = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([w])=>`• ${w}`);
  const actionRegex = /\b(todo|action|follow ?up|send|draft|review|approve|sow|scope|invoice|deadline|due)\b.*?(\.|$)/gi;
  const actions = [];
  for (const m of messages) {
    const t = m.text || '';
    let match; while ((match = actionRegex.exec(t))) actions.push(`• ${match[0].trim()}`);
  }
  return { model: 'fallback', bullets: top, actions: actions.slice(0,10) };
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

async function summarizeWithOpenAI(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackSummary(messages);

  const content = messages
    .slice().reverse()
    .map(m => `[${m.date}] ${String(m.text || '').replace(/\s+/g,' ').slice(0,400)}`)
    .join('\n');

  const body = {
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content:
`You are an operations assistant. Summarize the chat updates.
Return:
1) 4–6 concise bullet points (decisions, blockers, asks).
2) Action items with owners if mentioned.
3) Risks/unknowns.

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
    const result = await summarizeWithOpenAI(msgs);
    res.status(200).json(result);
  } catch (e) {
    console.error('summary error:', e);
    res.status(500).json({ error: 'server error' });
  }
};
