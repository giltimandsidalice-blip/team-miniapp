// api/status-auto.js
// AI + heuristics -> status. Persists to chat_status with updated_at.
// Returns { status, since_days }. Surfaces detailed errors with `stage`.

const { Pool } = require('pg');

function makePool() {
  if (!process.env.DATABASE_URL) {
    const e = new Error('DATABASE_URL missing');
    e.stage = 'env';
    throw e;
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}
const pool = makePool();

// Final labels
const LABELS = [
  'Talking',
  'Awaiting data',
  'Awaiting SoW',
  'SoW signed',
  'Awaiting payment',
  'Paid',
  'Data collection',
  'Campaign launched',
  'Report awaiting',
  'Finished'
];

// Heuristic floor
function heuristicStatus(texts) {
  const t = texts.join('\n').toLowerCase();

  // PAYMENT
  if (/(^|\W)(paid|payment received|we paid|txid|wire confirmed)(\W|$)/i.test(t)) return 'Paid';
  if (/(awaiting payment|send (the )?invoice|when can you pay|payment pending|wire details)/i.test(t)) return 'Awaiting payment';

  // SOW
  if (/sow signed|contract signed|agreement signed|countersigned|counter-signed|executed/i.test(t)) return 'SoW signed';
  if (/(please sign|sign (the )?sow|sign contract|awaiting sow|waiting for sow)/i.test(t)) return 'Awaiting SoW';

  // CAMPAIGN PROGRESS
  if (/(kol|influencer|creator).*(list|shortlist|select|choose|brief)|creative|assets|visuals/i.test(t)) return 'Data collection';
  if (/(kickoff|kicked off|go live|campaign live|launched|launch(ed)?|posts are live|content published)/i.test(t)) return 'Campaign launched';
  if (/(report due|waiting for report|awaiting report)/i.test(t)) return 'Report awaiting';
  if (/(final report|delivered report|results attached|post-mortem|wrap up|campaign finished)/i.test(t)) return 'Finished';

  // EARLY STAGES
  if (/(send your details|answer the questions|fill the brief|share requirements|please provide.*(criteria|answers))/i.test(t)) return 'Awaiting data';

  return 'Talking';
}

async function fetchNonTeamTexts(chatId, limit) {
  try {
    const { rows } = await pool.query(
      `select text, date
         from v_messages_non_team
        where chat_id = $1 and text is not null
        order by date desc
        limit $2`,
      [chatId, limit]
    );
    return rows.map(r => (r.text || '').replace(/\s+/g, ' ').slice(0, 500));
  } catch (e) {
    e.stage = 'db_view';
    throw e;
  }
}

async function refineWithAI(texts, guess) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !texts.length) return guess;

  const prompt =
`You are an ops assistant. From the chat snippets, choose ONE status label ONLY
from this exact set (respond with just the label string):
${LABELS.join(', ')}

Definitions:
- Talking — general discussion, not yet gathering detailed inputs.
- Awaiting data — asked client to provide answers/brief/criteria; waiting for their data.
- Awaiting SoW — asked them to review/sign SoW/contract; pending signature.
- SoW signed — explicit confirmation SoW/contract is signed.
- Awaiting payment — invoice/payment requested or pending, but not yet paid.
- Paid — explicit confirmation of payment received.
- Data collection — selecting KOLs, assets/visuals, creatives; pre-launch execution.
- Campaign launched — content/posts are live or campaign has launched.
- Report awaiting — campaign completed or near-complete; report requested/pending.
- Finished — final report delivered/close-out.

Snippets (latest first):
${texts.slice(0, 160).join('\n')}
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
    if (LABELS.includes(raw)) return raw;
    return guess;
  } catch (e) {
    // Don't fail the request on AI issues; fall back to heuristic
    return guess;
  }
}

async function persistAndCompute(chatId, status) {
  try {
    // upsert and only bump updated_at when status changes
    const cur = await pool.query(
      `select status, updated_at from chat_status where chat_id = $1`,
      [chatId]
    );
    if (!cur.rows[0]) {
      await pool.query(
        `insert into chat_status (chat_id, status, updated_at) values ($1,$2, now())`,
        [chatId, status]
      );
    } else if (cur.rows[0].status !== status) {
      await pool.query(
        `update chat_status set status=$2, updated_at=now() where chat_id=$1`,
        [chatId, status]
      );
    }
    const { rows } = await pool.query(
      `select status, updated_at from chat_status where chat_id = $1`,
      [chatId]
    );
    const row = rows[0] || { status, updated_at: null };

    let since_days = null;
    if (row.status === 'SoW signed' && row.updated_at) {
      const ms = Date.now() - new Date(row.updated_at).getTime();
      since_days = Math.max(0, Math.floor(ms / 86400000));
    }
    return { since_days };
  } catch (e) {
    e.stage = 'db_status';
    throw e;
  }
}

module.exports = async (req, res) => {
  try {
    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 800);
    if (!chatId) return res.status(400).json({ error: 'chat_id required', stage: 'input' });

    const texts = await fetchNonTeamTexts(chatId, limit);
    let guess = heuristicStatus(texts);
    guess = await refineWithAI(texts, guess);
    const { since_days } = await persistAndCompute(chatId, guess);

    res.status(200).json({ status: guess, since_days });
  } catch (e) {
    console.error('status-auto error:', e?.stage || 'unknown', e?.message || e);
    res.status(500).json({ error: e?.message || 'server error', stage: e?.stage || 'unknown' });
  }
};
