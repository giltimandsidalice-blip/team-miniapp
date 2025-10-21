// api/status-auto.js — FINAL (state machine; your exact workflow; conservative "Paid")
// ESM-compatible (package.json has "type":"module")

import { q } from './_db.js';

// Ordered lifecycle (must match UI)
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

// TRBE team usernames (lowercase)
const TEAM = new Set(['shefer712','web3reachout','travalss','phoebemangoba']);

// --- helpers ---
const lc = s => (s || '').toLowerCase();
const has = (s, re) => re.test(s);
const any = (s, arr) => arr.some(re => re.test(s));

// Questionnaire “criteria” keys (your exact list)
const CRITERIA = [
  /geo-?location of the kol/i,
  /sector focus/i,
  /minimum follower count/i,
  /preferred social media platforms?/i,
  /content languages?/i,
  /type of engagement/i,
  /budget/i
];

// "answers" hints a client might use when replying to criteria
const ANSWER_HINTS = [
  /\btwitter\b|\bx\b|\btelegram\b|\btiktok\b/i,
  /\benglish\b|\brussian\b|\bru\b|\ben\b/i,
  /\btier ?[1-3]\b/i,
  /\b50k\b|\b\$?\s?\d{2,3}k\b|\b\d+\s?(usd|usdt|stable|token)s?\b/i,
  /\bweb3\b|design|tech/i,
  /\bthreads?\b|\btweets?\b|\bposts?\b|\bspaces?\b/i,
  /\banything can work\b|\bwe can test\b/i
];

// SoW flow
const SOW_SHARE = [
  /\bwe(?:'|’)ll (?:prepare|share) (?:the )?statement of work\b/i,
  /\bwe(?:'|’)ll (?:prepare|share) (?:the )?sow\b/i,
  /\b(attaching|attached|prepared) (?:the )?sow\b/i,
  /\bplease review (?:the )?sow\b/i,
  /\bplease (?:share|provide) (?:the )?(?:signer|signatory).*(?:name|email)\b/i
];

const SOW_SIGNED = [
  /\bsow (?:signed|countersigned)\b/i,
  /\bcontract (?:signed|executed)\b/i,
  /\bagreement (?:signed|executed)\b/i,
  /\bsigned (?:the )?sow\b/i,
  /\bthanks (?:for )?signing\b.*\b(?:sow|contract|agreement)\b/i,
  /\bplease have a look at the (?:signed )?sow\b/i
];

// Payment (very conservative)
const INVOICE_SENT = [
  /\binvoice (?:sent|shared|issued)\b/i,
  /\bhere (?:is|\'s) (?:the )?invoice\b/i
];

// Paid ONLY on explicit receipt/confirmation (NOT just the word "paid")
const PAYMENT_RECEIVED = [
  /\bpayment (?:received|confirmed)\b/i,
  /\bwe (?:have )?received (?:the )?payment\b/i,
  /\bfunds (?:received|arrived)\b/i,
  /\btransaction (?:confirmed|completed)\b/i,
  /\btx (?:hash|id)\b.*\bconfirmed\b/i
];
// Guard: common “paid” false-positives we should ignore
const PAID_FALSE_POS = [
  /\bpaid attention\b/i,
  /\bprepaid card\b/i,
];

// Data collection (pre-launch ops)
const DATA_COLLECTION = [
  /\bkol\b.*\b(list|shortlist|select|choose|approve)\b/i,
  /\bcreatives?\b|\bbrief\b|\bassets?\b|\bcontent guidelines?\b/i,
  /\bmedia plan\b|\bwhitelist\b/i
];

// Campaign launched
const CAMPAIGN_LAUNCHED = [
  /\bposts? (?:are )?loaded (?:on|to) (?:the )?platform\b/i,
  /\bcheck (?:the )?platform\b/i,
  /\bcampaign (?:is )?live\b/i,
  /\bwent live\b/i,
  /\blaunch(?:ed|ing)\b(?:.*\bcampaign\b)?/i
];

// Report awaiting
const REPORT_AWAITING = [
  /\bthese (?:were|are) the last posts\b/i,
  /\bwe (?:will )?(?:soon )?provide (?:the )?report\b/i,
  /\breport (?:coming|pending|awaiting|due)\b/i
];

// Finished
const FINISHED = [
  /\breport (?:sent|shared|attached|delivered)\b/i,
  /\bfinal report\b.*\b(sent|shared|delivered|attached)\b/i,
  /\bcampaign (?:finished|closed|completed)\b/i
];

function idx(label){ return ORDER.indexOf(label); }
function better(a,b){ return idx(b) > idx(a); } // b is more advanced than a

function canUpgrade(from, to){
  if (!from) return true;
  const ai = idx(from), bi = idx(to);
  if (ai < 0 || bi < 0) return false;
  return bi > ai;
}

async function fetchRecent(chatId, limit){
  const { rows } = await q(
    `select m.id, m.date, m.text, lower(coalesce(u.username,'')) as username
       from messages m
       left join tg_users u on u.id = m.sender_id
      where m.chat_id = $1
        and m.text is not null
      order by m.date asc   -- process from oldest → newest (state machine)
      limit $2`,
    [chatId, limit]
  );
  return rows;
}

async function getSaved(chatId){
  const { rows } = await q(
    `select status, updated_at from chat_status where chat_id=$1`,
    [chatId]
  );
  return rows[0] || null;
}

async function saveStatus(chatId, status, touchSoWTime=false){
  if (touchSoWTime && status === 'SoW signed'){
    await q(
      `insert into chat_status (chat_id, status, updated_at)
       values ($1,$2,now())
       on conflict (chat_id) do update set status=excluded.status, updated_at=now()`,
      [chatId, status]
    );
  } else {
    await q(
      `insert into chat_status (chat_id, status, updated_at)
       values ($1,$2,coalesce((select updated_at from chat_status where chat_id=$1), now()))
       on conflict (chat_id) do update set status=excluded.status`,
      [chatId, status]
    );
  }
}

// Decide status by scanning messages oldest → newest and flipping flags
function decideStatus(rows){
  let status = 'Talking';

  let questionnaireSent = false;   // sent by TEAM
  let clientAnswered    = false;   // non-TEAM replies with multiple answers
  let sowShare          = false;   // team prepares/shares/asks signer
  let sowSigned         = false;

  let invoiceSent       = false;
  let paymentReceived   = false;

  let dataOps           = false;
  let launched          = false;
  let reportSoon        = false;
  let reportSent        = false;

  for (const m of rows){
    const isTeam = TEAM.has((m.username||'').toLowerCase());
    const text = String(m.text||'');

    // --- Finished / Report awaiting / Campaign launched (these override most) ---
    if (any(text, FINISHED))       { reportSent = true; }
    if (any(text, REPORT_AWAITING)){ reportSoon = true; }
    if (any(text, CAMPAIGN_LAUNCHED)){ launched = true; }

    // --- Payments (conservative) ---
    if (any(text, INVOICE_SENT) && isTeam) invoiceSent = true;
    if (any(text, PAYMENT_RECEIVED) && !any(text, PAID_FALSE_POS)) paymentReceived = true;

    // --- SoW ---
    if (any(text, SOW_SIGNED)) sowSigned = true;
    if (any(text, SOW_SHARE) && isTeam) sowShare = true;

    // --- Data ops (KOL/creatives/brief) ---
    if (any(text, DATA_COLLECTION)) dataOps = true;

    // --- Questionnaire sent (TEAM sends the criteria list) ---
    if (isTeam){
      let hits = 0;
      for (const re of CRITERIA){ if (has(text, re)) hits++; }
      if (hits >= 3) questionnaireSent = true; // require multiple bullets to set it
    }

    // --- Client answered (non-TEAM replies with >=2 answer hints) ---
    if (!isTeam){
      let ans = 0;
      for (const re of ANSWER_HINTS){ if (has(text, re)) ans++; }
      if (ans >= 2) clientAnswered = true;
    }
  }

  // Now translate flags → status (strict precedence)
  if (reportSent)      return 'Finished';
  if (reportSoon)      return 'Report awaiting';
  if (launched)        return 'Campaign launched';

  // Payment stages are only meaningful after SoW is at least shared/signed.
  if (sowSigned && paymentReceived) return 'Paid';
  if (sowSigned && invoiceSent)     return 'Awaiting payment';

  // Post-SoW content work
  if (sowSigned && dataOps)         return 'Data collection';
  if (sowSigned)                    return 'SoW signed';
  if (sowShare || (clientAnswered && isLikelySoWTriggered(rows))) return 'Awaiting SoW';

  if (questionnaireSent && !clientAnswered) return 'Awaiting data';
  return 'Talking';
}

// Heuristic: if client answered and within a few messages team mentioned SoW, treat as SoW flow
function isLikelySoWTriggered(rows){
  // Look at last ~30 messages
  const recent = rows.slice(-30);
  return recent.some(m => TEAM.has((m.username||'').toLowerCase()) && any(String(m.text||''), SOW_SHARE));
}

export default async function handler(req,res){
  try{
    const chatId = req.query.chat_id;
    const limit  = Math.min(parseInt(req.query.limit||'320',10), 800);
    if(!chatId) return res.status(400).json({ error:'chat_id required' });

    const rows = await fetchRecent(chatId, limit);
    const detected = decideStatus(rows);

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
          final = saved.status; // keep manual or previous (no downgrade)
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
    console.error('status-auto error:', e);
    return res.status(500).json({ error:'server error' });
  }
}
