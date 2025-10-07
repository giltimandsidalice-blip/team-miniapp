// api/status-auto.js (ESM)
// Heuristics + optional AI, but will NOT downgrade: only advances status.

const ORDER = [
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
const LABELS = ORDER;

function rank(label){ const i=ORDER.indexOf(label); return i<0? -1 : i; }

async function getPool() {
  const pg = await import('pg');
  const { Pool } = pg;
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

// rules with quick “evidence” extraction
const RULES = [
  { label: 'Paid', re: /(^|\W)(paid|payment received|we paid|txid|wire confirmed|funds received)(\W|$)/i },
  { label: 'Awaiting payment', re: /(awaiting payment|send (the )?invoice|invoice sent|when can you pay|payment pending|wire details|bank details)/i },
  { label: 'SoW signed', re: /(sow signed|contract signed|agreement signed|countersigned|counter-signed|executed)/i },
  { label: 'Awaiting SoW', re: /(please sign|sign (the )?sow|sign contract|awaiting sow|waiting for sow|share sow|send sow)/i },
  { label: 'Campaign launched', re: /(kickoff|kicked off|campaign live|launched|launch(ed)?|posts are live|content published|went live)/i },
  { label: 'Report awaiting', re: /(report due|waiting for report|awaiting report)/i },
  { label: 'Finished', re: /(final report|delivered report|results attached|post-mortem|wrap up|campaign finished)/i },
  { label: 'Data collection', re: /(kol|influencer|creator).*(list|shortlist|select|choose|brief)|creative|assets|visuals|deliverables/i },
  { label: 'Awaiting data', re: /(send your details|answer the questions|fill the brief|share requirements|please provide.*(criteria|answers)|questions above)/i },
];

function heuristic(texts){
  const joined = texts.join('\n');
  for (const rule of RULES) {
    const m = joined.match(rule.re);
    if (m) {
      const line = joined.split('\n').find(l=>rule.re.test(l)) || m[0];
      return { guess: rule.label, evidence: (line||'').trim().slice(0,200) };
    }
  }
  return { guess:'Talking', evidence:'' };
}

async function fetchNonTeamTexts(pool, chatId, limit){
  const r = await pool.query(
    `select text from v_messages_non_team
     where chat_id=$1 and text is not null
     order by date desc
     limit $2`, [chatId, limit]);
  return r.rows.map(x => (x.text||'').replace(/\s+/g,' ').slice(0,500));
}

async function refineWithAI(texts, guess){
  const key = process.env.OPENAI_API_KEY;
  if(!key || !texts.length) return guess;
  const prompt = `Return exactly one label from: ${LABELS.join(', ')}\n\nSnippets:\n${texts.slice(0,160).join('\n')}`;
  try{
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${key}`},
      body: JSON.stringify({ model:'gpt-4o-mini', temperature:0, messages:[{role:'user', content:prompt}] })
    });
    const data = await r.json();
    const raw = (data?.choices?.[0]?.message?.content||'').trim();
    return LABELS.includes(raw) ? raw : guess;
  }catch{ return guess; }
}

export default async function handler(req, res){
  try{
    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit||'200',10),800);
    if(!chatId) return res.status(400).json({ error:'chat_id required', stage:'input' });

    const pool = await getPool();

    // current status (to enforce forward-only)
    const curR = await pool.query(`select status, updated_at from chat_status where chat_id=$1`, [chatId]);
    const cur = curR.rows[0]?.status || null;

    const texts = await fetchNonTeamTexts(pool, chatId, limit);
    let { guess, evidence } = heuristic(texts);
    const refined = await refineWithAI(texts, guess);

    // forward-only: keep the one with higher rank
    const next = (cur && rank(cur) >= rank(refined)) ? cur : refined;

    // upsert only if changed
    if (!cur) {
      await pool.query(`insert into chat_status(chat_id,status,updated_at) values($1,$2,now())`, [chatId, next]);
    } else if (cur !== next) {
      await pool.query(`update chat_status set status=$2, updated_at=now() where chat_id=$1`, [chatId, next]);
    }

    // compute sow_days
    let sow_days = null;
    if (next === 'SoW signed') {
      const r2 = await pool.query(`select updated_at from chat_status where chat_id=$1`, [chatId]);
      const ts = r2.rows[0]?.updated_at;
      if (ts) sow_days = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime())/86400000));
    }

    res.json({ status: next, since_days: sow_days, evidence });
  }catch(e){
    console.error('status-auto error', e);
    res.status(500).json({ error:e?.message||'server error', stage: e?.stage||'unknown' });
  }
}
