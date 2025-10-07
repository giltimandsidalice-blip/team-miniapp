// api/status-auto.js — STRICT, RULE-BASED (matches your spec)
// ESM, works with "type":"module"
// - Reads existing chat_status (manual/previous)
// - Detects status from recent messages using YOUR phrases
// - Only upgrades (never downgrades) a saved manual status
// - When first becomes “SoW signed”, sets updated_at = now()
// - Returns { status, decided, status_updated_at, samples_used }

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Final ordered labels (exact text as in your app)
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

// Team usernames (lowercase), used for some cues
const TEAM = new Set(['shefer712','web3reachout','travalss','phoebemangoba']);

/* ---------------------------
   TEXT HELPERS (case-insensitive)
---------------------------- */
function has(s, re){ return re.test(s); }
function any(s, arr){ return arr.some(re => re.test(s)); }
function lc(s){ return (s||'').toLowerCase(); }

/* ---------------------------
   YOUR RULES (strict)
   Highest → lowest precedence
---------------------------- */
/*
Definitions you gave:

1) Talking — everything before Kate/Arina send the criteria message (questionnaire).
2) Awaiting data — after the criteria message is sent, until client replies with answers.
3) Awaiting SoW — once client provides those answers and team moves to SoW talk (share/prepare/ask signer).
4) SoW signed — explicit confirmation the SoW is signed.
5) Awaiting payment — invoice sent / awaiting payment / processing payment.
6) Paid — payment received/confirmed/tx provided.
7) Data collection — KOLs/creatives/brief/data prep between SoW signed and campaign going live.
8) Campaign launched — posts loaded/on platform/campaign live/launched.
9) Report awaiting — after final/last posts and awaiting/mention of upcoming report.
10) Finished — report sent/shared/attached/finalized.

We match exact phrasing you shared.
*/

function detectStatusFromText(all) {
  const t = lc(all);

  // 10) Finished
  if (any(t, [
    /\b(report (?:sent|shared|attached|delivered))\b/,
    /\bfinal report\b.*\b(sent|shared|delivered|attached)\b/,
    /\bcampaign (?:finished|closed|completed)\b/,
  ])) return 'Finished';

  // 9) Report awaiting
  if (any(t, [
    /\b(report|post[-\s]?mortem)\b.*\b(coming|soon|pending|awaiting|due)\b/,
    /\bawaiting (?:the )?report\b/,
    /\bthese (?:were|are) the last posts\b/,
    /\bwe will (?:soon )?provide (?:the )?report\b/,
  ])) return 'Report awaiting';

  // 8) Campaign launched
  if (any(t, [
    /\bposts? (?:are )?loaded (?:on|to) (?:the )?platform\b/,
    /\bcheck (?:the )?platform\b/,
    /\bcampaign (?:is )?live\b/,
    /\bwent live\b/,
    /\blaunch(?:ed|ing)\b(?:.*\bcampaign\b)?/,
  ])) return 'Campaign launched';

  // 6) Paid (higher precedence than Awaiting payment)
  if (any(t, [
    /\bpayment (?:received|confirmed)\b/,
    /\bwe (?:have )?paid\b/,
    /\bpaid\b(?!\s?attention)/,
    /\binvoice (?:settled|paid)\b/,
    /\btx\b.*\b(hash|id)\b/,
  ])) return 'Paid';

  // 5) Awaiting payment
  if (any(t, [
    /\binvoice (?:sent|shared|issued)\b/,
    /\bawaiting payment\b/,
    /\bprocessing payment\b/,
    /\bplease proceed with (?:the )?payment\b/,
  ])) return 'Awaiting payment';

  // 4) SoW signed (explicit)
  if (any(t, [
    /\bsow (?:signed|countersigned)\b/,
    /\bcontract (?:signed|executed)\b/,
    /\bagreement (?:signed|executed)\b/,
    /\bsigned (?:the )?sow\b/,
    /\bthanks (?:for )?signing\b.*\b(?:sow|contract|agreement)\b/,
    /\bplease have a look at the (?:signed )?sow\b/,
  ])) return 'SoW signed';

  // 3) Awaiting SoW (client answered criteria + team moves to SoW)
  if (any(t, [
    // team says: we’ll prepare/share the SoW or asks for signer name/email
    /\bwe(?:'|’)ll (?:prepare|share) (?:the )?statement of work\b/,
    /\bwe(?:'|’)ll (?:prepare|share) (?:the )?sow\b/,
    /\bplease (?:share|provide) (?:the )?(?:signer|signatory).*(?:name|email)\b/,
    /\b(attaching|attached|prepared) (?:the )?sow\b/,
    /\bplease review (?:the )?sow\b/,
  ])) return 'Awaiting SoW';

  // 7) Data collection (pre-launch ops, KOL/creative/assets/brief)
  if (any(t, [
    /\bkol\b.*\b(list|shortlist|select|choose|approve)\b/,
    /\bcreatives?\b|\bbrief\b|\bassets?\b|\bcontent guidelines?\b/,
    /\bmedia plan\b|\bwhitelist\b/,
  ])) return 'Data collection';

  // 2) Awaiting data (questionnaire sent; waiting for answers)
  if (any(t, [
    // the checklist message (your exact bullet points/keywords)
    /\bgeo-?location of the kol/i,
    /\bsector focus\b/i,
    /\bminimum follower count\b/i,
    /\bpreferred social media platforms?\b/i,
    /\bcontent languages?\b/i,
    /\btype of engagement\b/i,
    /\bbudget\b.*\b(stablecoins?|usd|usdt|tokens?)\b/i,
    /\bmain (?:focus|objective)\b/i,
    /\bthemes?\b|\bkey messages?\b/i,
    /\brequired hashtags?\b|\bhandles?\b/i,
    /\burls?\b to be featured\b/i,
    /\bname and email of (?:the )?person who will sign (?:the )?sow\b/i,
    /\bwe(?:'|’)ll share a statement of work\b/i,
  ])) return 'Awaiting data';

  // 1) Talking (default)
  return 'Talking';
}

/* ---------------------------
   DB helpers
---------------------------- */
async function fetchRecent(chatId, limit){
  const { rows } = await pool.query(
    `select m.id, m.date, m.text, lower(coalesce(u.username,'')) as username
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
  } else {
    await pool.query(
      `insert into chat_status (chat_id, status, updated_at)
       values ($1,$2,coalesce((select updated_at from chat_status where chat_id=$1), now()))
       on conflict (chat_id) do update set status=excluded.status`,
      [chatId, status]
    );
  }
}

function canUpgrade(from,to){
  const a = ORDER.indexOf(from);
  const b = ORDER.indexOf(to);
  if (a < 0) return true;      // nothing saved yet → allow
  if (b < 0) return false;     // unknown new label → block
  return b > a;                // only upgrade, never downgrade
}

/* ---------------------------
   Handler
---------------------------- */
export default async function handler(req,res){
  try{
    const chatId = req.query.chat_id;
    const limit  = Math.min(parseInt(req.query.limit||'300',10), 800);
    if(!chatId) return res.status(400).json({ error:'chat_id required' });

    const rows = await fetchRecent(chatId, limit);
    const joined = rows.map(r => {
      const u = r.username ? '@'+r.username+': ' : '';
      return `[${r.date}] ${u}${String(r.text||'').replace(/\s+/g,' ')}`;
    }).join('\n');

    // STRICT DETECTION
    const detected = detectStatusFromText(joined);

    // Saved/manual
    const saved = await getSaved(chatId);

    let final = detected;
    let updated_at = saved?.updated_at || null;

    if (saved?.status){
      if (saved.status !== detected){
        if (canUpgrade(saved.status, detected)){
          const touch = (detected === 'SoW signed' && saved.status !== 'SoW signed');
          await saveStatus(chatId, detected, touch);
          if (touch) updated_at = new Date();
          final = detected;
        } else {
          // keep manual/saved
          final = saved.status;
        }
      } else {
        final = saved.status;
      }
    } else {
      const touch = (detected === 'SoW signed');
      await saveStatus(chatId, detected, touch);
      if (touch) updated_at = new Date();
      final = detected;
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
