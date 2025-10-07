// api/status-auto.js (FINAL, strict rules + DB-aware)
// - Reads current saved status (chat_status)
// - Applies strict ordered rules from last ~300 msgs (team + client)
// - Never downgrades a manual status; only upgrades when strong evidence
// - When flips to "SoW signed" first time, writes updated_at=now() (used for day counter)
// - Returns: { status, decided, status_updated_at, samples_used }

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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

// TRBE team usernames (lowercase)
const TEAM = new Set(['shefer712','web3reachout','travalss','phoebemangoba']);

// ---- strict detection helpers ----
function has(t, re){ return re.test(t); }
function any(t, arr){ return arr.some(re => re.test(t)); }

function detectStrictStatus(allText){
  const t = allText.toLowerCase();

  // 1) Finished
  if (any(t, [
    /\bfinal report\b/, /\breport (?:sent|delivered|attached)\b/, /\bcampaign (?:closed|finished|completed)\b/
  ])) return 'Finished';

  // 2) Report awaiting
  if (any(t, [
    /\breport (?:due|pending|awaiting)\b/, /\bwaiting for (?:the )?report\b/, /\bwrap up report\b/
  ])) return 'Report awaiting';

  // 3) Campaign launched
  if (any(t, [
    /\bcampaign (?:is )?live\b/, /\bposts (?:are )?live\b/, /\bwent live\b/, /\blaunch(?:ed|ing)\b.*\bcampaign\b/,
  ])) return 'Campaign launched';

  // 4) Paid
  if (any(t, [
    /\bpayment (?:received|confirmed)\b/, /\bpaid\b/, /\binvoice (?:settled|paid)\b/, /\btx\b.*\b(hash|id)\b/,
  ])) return 'Paid';

  // 5) Awaiting payment
  if (any(t, [
    /\binvoice (?:sent|shared|issued)\b/, /\bawaiting payment\b/, /\bprocessing payment\b/,
  ])) return 'Awaiting payment';

  // 6) SoW signed
  if (any(t, [
    /\bsow (?:signed|countersigned)\b/, /\bcontract (?:signed|executed)\b/, /\bagreement (?:signed|executed)\b/,
    /\bsigned the sow\b/, /\bthanks (?:for|for) signing\b/,
  ])) return 'SoW signed';

  // 7) Awaiting SoW
  if (any(t, [
    /\bstatement of work\b/, /\bsow\b.*\b(send|share|prepare)\b/, /\bplease (?:sign|review)\b.*\bsow\b/,
    /\bshare signer (?:name|email)\b/, /\bwe(?:'|’)ll prepare the sow\b/,
  ])) return 'Awaiting SoW';

  // 8) Data collection (KOLs/creatives, pre-launch)
  if (any(t, [
    /\bkol\b.*\b(list|shortlist|select|choose|approve)\b/,
    /\bcreatives?\b|\bbrief\b|\bcontent guidelines?\b|\bassets?\b/,
    /\btargets?\b.*\bkol\b/, /\bwhitelist\b/, /\bmedia plan\b/
  ])) return 'Data collection';

  // 9) Awaiting data (questionnaire sent; still collecting basics)
  if (any(t, [
    /\bgeo-?location\b/, /\bsector\b/, /\bminimum follower\b/, /\bpreferred social\b/,
    /\bcontent languages?\b/, /\btype of engagement\b/, /\bbudget\b.*\b(usdt|usd|stable|token)s?\b/,
    /\bmain (?:focus|objective)\b/, /\bthemes?\b|\bkey messages?\b/,
  ])) return 'Awaiting data';

  // 10) Talking
  return 'Talking';
}

async function fetchRecent(chatId, limit){
  const { rows } = await pool.query(
    `select m.id, m.date, m.text, u.username
       from messages m
       left join tg_users u on u.id = m.sender_id
      where m.chat_id = $1
        and m.text is not null
      order by m.date desc
      limit $2`,
    [chatId, limit]
  );
  return rows;
}

async function getSaved(chatId){
  const r = await pool.query(
    `select status, updated_at from chat_status where chat_id=$1`, [chatId]
  );
  return r.rows[0] || null;
}

async function saveStatus(chatId, status, touchSoWTime=false){
  if (touchSoWTime && status === 'SoW signed'){
    await pool.query(
      `insert into chat_status (chat_id, status, updated_at)
       values ($1,$2,now())
       on conflict (chat_id) do update set status=excluded.status, updated_at=now()`,
       [chatId, status]
    );
  }else{
    await pool.query(
      `insert into chat_status (chat_id, status, updated_at)
       values ($1,$2,coalesce((select updated_at from chat_status where chat_id=$1), now()))
       on conflict (chat_id) do update set status=excluded.status`,
       [chatId, status]
    );
  }
}

function canUpgrade(from,to){
  const order = [
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
  const a = order.indexOf(from); const b = order.indexOf(to);
  if (a<0) return true;
  return b > a; // only upgrade, never downgrade
}

export default async function handler(req,res){
  try{
    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit||'300',10), 800);
    if(!chatId) return res.status(400).json({ error:'chat_id required' });

    const rows = await fetchRecent(chatId, limit);
    const allText = rows.map(r => `[${r.date}] ${r.username?('@'+r.username+': '):''}${(r.text||'').replace(/\s+/g,' ')}`).join('\n');

    const detected = detectStrictStatus(allText);
    const saved = await getSaved(chatId);

    let final = detected;
    let updated_at = saved?.updated_at || null;

    if (saved?.status){
      if (saved.status !== detected){
        if (canUpgrade(saved.status, detected)){
          // upgrade; if moving into SoW signed first time, stamp updated_at
          const touchTime = (detected === 'SoW signed' && saved.status !== 'SoW signed');
          await saveStatus(chatId, detected, touchTime);
          if (touchTime) updated_at = new Date(); // now
        }else{
          // keep saved manual/previous status
          final = saved.status;
        }
      }else{
        final = saved.status;
      }
    }else{
      // nothing saved yet → save detected
      const touchTime = (detected === 'SoW signed');
      await saveStatus(chatId, detected, touchTime);
      if (touchTime) updated_at = new Date(); // now
    }

    return res.json({
      status: final,
      decided: (saved?.status && saved.status!==detected) ? 'kept_saved' : (saved?.status ? 'saved_or_auto' : 'auto'),
      status_updated_at: updated_at,
      samples_used: rows.length
    });
  }catch(e){
    console.error('status-auto strict error:', e);
    return res.status(500).json({ error:'server error' });
  }
}
