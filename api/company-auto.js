// api/company-auto.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Try to pull an obvious “blurb” from v_candidate_blurbs.
// Falls back to scanning recent non-team messages for keywords.
module.exports = async (req, res) => {
  try {
    const chatId = req.query.chat_id;
    if (!chatId) return res.status(400).json({ error: 'chat_id required' });

    // 1) Use the view (already excludes team members)
    const top = await pool.query(
      `select chat_id, id, date, text, score
       from v_candidate_blurbs
       where chat_id = $1
       order by score desc, date desc
       limit 1`,
      [chatId]
    );

    if (top.rows.length) {
      return res.status(200).json({
        source: 'view',
        text: top.rows[0].text,
        score: top.rows[0].score,
        date: top.rows[0].date,
      });
    }

    // 2) Fallback: scan recent non-team messages
    const recent = await pool.query(
      `select m.text, m.date
         from v_messages_non_team m
        where m.chat_id = $1 and m.text is not null
        order by m.date desc
        limit 300`,
      [chatId]
    );

    const KEY = /(about|we are|our (?:project|company)|mission|vision|overview)/i;
    const candidate = recent.rows.find(r => KEY.test(r.text || '') && (r.text || '').length > 80);

    if (candidate) {
      return res.status(200).json({
        source: 'fallback',
        text: candidate.text,
        date: candidate.date,
      });
    }

    // 3) Optional AI refine if OPENAI_API_KEY present
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && recent.rows.length) {
      const joined = recent.rows
        .map(r => (r.text || '').replace(/\s+/g,' ').slice(0,400))
        .join('\n');

      const body = {
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content:
`Read these chat messages (non-team). Extract a concise company blurb
in 3–6 sentences, English only. If nothing is clear, say "No clear blurb".
Messages:\n${joined}`
        }],
        temperature: 0.2
      };

      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content?.trim();

      return res.status(200).json({
        source: 'openai',
        text: text || 'No clear blurb',
      });
    }

    return res.status(200).json({ source: 'none', text: null });
  } catch (e) {
    console.error('company-auto error:', e);
    res.status(500).json({ error: 'server error' });
  }
};
