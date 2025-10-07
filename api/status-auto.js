// api/status-auto.js (ESM)
// AI + heuristics -> status. Persists to chat_status with updated_at.
// Returns { status, since_days, evidence }. Detailed errors include a `stage`.

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

// Build a PG pool (dynamic import to avoid cold start crashes)
async function getPool() {
  if (!process.env.DATABASE_URL) {
    const e = new Error('DATABASE_URL missing');
    e.stage = 'env';
    throw e;
  }
  const pg = await import('pg').catch((err) => {
    err.stage = 'import_pg';
    throw err;
  });
  const { Pool } = pg;
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

// ---------- Heuristics with evidence ----------
const RULES = [
  // Payment
  { label: 'Paid', re: /(^|\W)(paid|payment received|we paid|txid|wire confirmed|funds received)(\W|$)/i },
  { label: 'Awaiting payment', re: /(awaiting payment|send (the )?invoice|invoice sent|when can you pay|payment pending|wire details|bank details)/i },

  // SoW
  { label: 'SoW signed', re: /(sow signed|contract signed|agreement signed|countersigned|counter-signed|executed)/i },
  { label: 'Awaiting SoW', re: /(please sign|sign (the )?sow|sign contract|awaiting sow|waiting for sow|share sow|send sow)/i },

  // Campaign progress
  { label: 'Campaign launched', re: /(kickoff|kicked off|campaign live|launched|launch(ed)?|posts are live|content published|went live)/i },
  { label: 'Report awaiting', re: /(report due|waiting for report|awaiting report)/i },
  { label: 'Finished', re: /(final report|delivered report|results attached|post-mortem|wrap up|campaign finished)/i },

  // Pre-launch execution
  { label: 'Data collection', re: /(kol|influencer|creator).*(list|shortlist|select|choose|brief)|creative|assets|visuals|deliverables/i },

  // Early stages
  { label: 'Awaiting data', re: /(send your details|answer the questions|fill the brief|share requirements|please provide.*(criteria|answers)|questions above)/i },
];

function heuristic(texts) {
  const joined = texts.join('\n');
  for (const rule of RULES) {
    const m = joined.match(rule.re);
    if (m) {
      // find a short evidence line
      const line = joined
        .split('\n')
        .find(l => rule.re.test(l)) || m[0];
      return { guess: rule.label, evidence: (line || '').trim().slice(0, 200) };
    }
  }
  return { guess: 'Talking', evidence: '' };
}

// ---------- DB helpers ----------
async function fetchNonTeamTexts(pool, chatId, limit) {
  try {
    const r = await pool.query(
      `select text, date
         from v_messages_non_team
        where chat_id = $1 and text is not null
        order by date desc
        limit $2`,
      [chatId, limit]
    );
    return r.rows.map(x => (x.text || '').replace(/\s+/g, ' ').slice(0, 500));
  } catch (e) {
    e.stage = 'db_view';
    throw e;
  }
}

async function upsertStatus(pool, chatId, newStatus) {
  try {
    const cur = await pool.query(
      `select status, updated_at from chat_status where chat_id = $1`,
      [chatId]
    );
    if (!cur.rows[0]) {
      await pool.query(
        `insert into chat_status (chat_id, status, updated_at) values ($1,$2, now())`,
        [chatId, newStatus]
      );
    } else if (cur.rows[0].status !== newStatus) {
      await pool.query(
        `update chat_status set status=$2, updated_at=now() where chat_id=$1`,
        [chatId, newStatus]
      );
    }
    const after = await pool.query(
      `select status, updated_at from chat_status where chat_id = $1`,
      [chatId]
    );
    const row = after.rows[0] || { status: newStatus, updated_at: null };
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

// ---------- Optional AI refinement ----------
async function refineWithAI(texts, guess) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !texts.length) return guess;

  const prompt =
`Choose ONE status label ONLY from this exact set (respond with just the label string):
${LABELS.join(', ')}

Definitions:
- Talking — general discussion, not yet gathering detailed inputs.
- Awaiting data — asked client to provide answers/brief/criteria; waiting for their data.
- Awaiting SoW — asked them to review/sign SoW/contract; pending signature.
- SoW signed — explicit confirmation SoW/contract is signed.
- Awaiting payment — invoice/payment requested or pending, but not yet paid.
- Paid — explicit confirmation of payment received.
- Data collection — selecting KOLs, assets/visuals, creatives; pre-launch execution.
- Campaign launched — posts/content live; campaign has launched.
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
  } catch {
    // Don’t break on AI errors; stick to heuristic
    return guess;
  }
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed', stage: 'method' });
    }

    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 800);
    if (!chatId) return res.status(400).json({ error: 'chat_id required', stage: 'input' });

    const pool = await getPool();
    const texts = await fetchNonTeamTexts(pool, chatId, limit);

    // Heuristic with evidence
    let { guess, evidence } = heuristic(texts);

    // AI refinement (keeps heuristic if AI is down or returns unknown)
    const refined = await refineWithAI(texts, guess);

    // Persist + compute since_days
    const { since_days } = await upsertStatus(pool, chatId, refined);

    res.status(200).json({ status: refined, since_days, evidence });
  } catch (e) {
    console.error('status-auto error:', e?.stage || 'unknown', e?.message || e);
    res.status(500).json({ error: e?.message || 'server error', stage: e?.stage || 'unknown' });
  }
}
