// api/status-auto.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Your statuses (final labels we’ll return)
const LABELS = [
  'Talking stage',
  'Awaiting SoW',
  'SoW signed',
  'Preparing campaign',
  'Campaign live',
  'Awaiting report',
  'Campaign finished'
];

// Very lightweight keyword heuristics first
function heuristicStatus(texts) {
  const t = texts.join('\n').toLowerCase();

  if (/sow signed|contract signed|agreement signed|counter-signed|executed/i.test(t)) return 'SoW signed';
  if (/(please sign|sign the sow|sign contract|awaiting sow|waiting for sow)/i.test(t)) return 'Awaiting SoW';
  if (/(kickoff|kicked off|go live|launch(ed)?|campaign live|started campaign)/i.test(t)) return 'Campaign live';
  if (/(final report|delivered report|results attached|post-mortem)/i.test(t)) return 'Campaign finished';
  if (/(report due|waiting for report|awaiting report)/i.test(t)) return 'Awaiting report';
  if (/(kol|influencer|creator).* (list|shortlist|select|choos)/i.test(t)) return 'Preparing campaign';
  return 'Talking stage';
}

module.exports = async (req, res) => {
  try {
    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 800);
    if (!chatId) return res.status(400).json({ error: 'chat_id required' });

    // Pull recent non-team messages (so internal chatter doesn't skew status)
    const { rows } = await pool.query(
      `select text, date
         from v_messages_non_team
        where chat_id = $1 and text is not null
        order by date desc
        limit $2`,
      [chatId, limit]
    );
    const texts = rows.map(r => (r.text || '').replace(/\s+/g,' ').slice(0,400));

    // 1) Heuristic guess
    let guess = heuristicStatus(texts);

    // 2) Optional AI refinement to your exact label set, English only
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && texts.length) {
      const prompt =
`You are an ops assistant. From the chat snippets, choose ONE status label ONLY
from this exact set (respond with just the label string):
${LABELS.join(', ')}

Definitions:
- Talking stage — general discussion, no SoW mentioned.
- Awaiting SoW — they are asked to sign or confirm SoW/contract.
- SoW signed — explicit confirmation SoW/contract is signed.
- Preparing campaign — discussing KOLs/creatives/briefs/requirements before launch.
- Campaign live — campaign has launched or is running.
- Awaiting report — campaign done or nearing completion; report requested/pending.
- Campaign finished — final report delivered / campaign closed.

Output MUST be English and MUST be exactly one of the labels above.

Snippets (latest first):
${texts.slice(0,120).join('\n')}
`;

      const body = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0
      };

      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        const raw = (data?.choices?.[0]?.message?.content || '').trim();
        if (LABELS.includes(raw)) guess = raw;
      } catch (_) { /* fall back to heuristic */ }
    }

    res.status(200).json({ status: guess, samples_used: texts.length });
  } catch (e) {
    console.error('status-auto error:', e);
    res.status(500).json({ error: 'server error' });
  }
};
