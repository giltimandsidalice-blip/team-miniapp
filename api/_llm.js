// api/_llm.js
function scrubPII(s) {
  if (!s) return s;
  return s
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/\b\+?\d[\d\s().-]{7,}\b/g, '[phone]')
    .replace(/https?:\/\/\S+/g, '[link]');
}

async function chatComplete({ system, user, model = 'gpt-4o-mini', temperature = 0.2 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || 'OpenAI error');
  return (j?.choices?.[0]?.message?.content || '').trim();
}

module.exports = { scrubPII, chatComplete };
