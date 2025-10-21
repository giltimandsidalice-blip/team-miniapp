// api/status-auto.js — FINAL (state machine; your exact workflow; conservative "Paid")
// ESM-compatible (package.json has "type":"module")

import { getSupabase } from "@/api/_utils/supabase";

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
@@ -103,88 +103,139 @@ const CAMPAIGN_LAUNCHED = [

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

async function fetchRecent(supabase, chatId, limit){
  const { data, error } = await supabase
    .from('messages')
    .select('id, date, text, sender_id')
    .eq('chat_id', chatId)
    .not('text', 'is', null)
    .order('date', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`fetch_recent_failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  const senderIds = Array.from(new Set(rows.map(r => r.sender_id).filter(id => id !== null && id !== undefined)));

  const usernameMap = new Map();
  if (senderIds.length) {
    const { data: users, error: userError } = await supabase
      .from('tg_users')
      .select('id, username')
      .in('id', senderIds);

    if (userError) {
      throw new Error(`fetch_users_failed: ${userError.message}`);
    }

    for (const user of users || []) {
      usernameMap.set(user.id, (user.username || '').toLowerCase());
    }
  }

  return rows.map(row => ({
    id: row.id,
    date: row.date,
    text: row.text,
    username: usernameMap.get(row.sender_id) || '',
  }));
}

async function getSaved(supabase, chatId){
  const { data, error } = await supabase
    .from('chat_status')
    .select('status, updated_at')
    .eq('chat_id', chatId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`get_saved_failed: ${error.message}`);
  }

  return data || null;
}

async function saveStatus(supabase, chatId, status, { touchSoWTime = false, existingUpdatedAt = null } = {}){
  let updatedAt = null;

  if (touchSoWTime && status === 'SoW signed') {
    updatedAt = new Date();
  } else if (existingUpdatedAt) {
    const parsed = new Date(existingUpdatedAt);
    if (!Number.isNaN(parsed.getTime())) {
      updatedAt = parsed;
    }
  }

  if (!updatedAt) {
    updatedAt = new Date();
  }

  const iso = updatedAt.toISOString();

  const { error } = await supabase
    .from('chat_status')
    .upsert(
      {
        chat_id: chatId,
        status,
        updated_at: iso,
      },
      { onConflict: 'chat_id' }
    );

  if (error) {
    throw new Error(`save_status_failed: ${error.message}`);
  }

  return iso;
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
@@ -226,64 +277,75 @@ function decideStatus(rows){
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
    const usernameHeader = req.headers['x-telegram-username'];
    const idHeader = req.headers['x-telegram-id'];
    const tgUsername = (Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader)?.replace('@', '')?.toLowerCase();
    const tgUserId = Array.isArray(idHeader) ? idHeader[0] : idHeader;

    if (!tgUsername || !tgUserId) {
      return res.status(401).json({ error: 'Unauthorized access: missing Telegram identity' });
    }
    const chatId = req.query.chat_id;
    const limit  = Math.min(parseInt(req.query.limit||'320',10), 800);
    if(!chatId) return res.status(400).json({ error:'chat_id required' });

    const supabase = getSupabase();

    const { data: members = [], error: memberError } = await supabase
      .from('team_members')
      .select('tg_username')
      .eq('tg_username', tgUsername)
      .limit(1);

    if (memberError || members.length === 0) {
      return res.status(401).json({ error: 'Unauthorized access: not a team member' });
    }
    const rows = await fetchRecent(supabase, chatId, limit);
    if (!rows.length) {
      console.warn('status-auto: no messages returned – possible RLS block for chat', chatId);
    }
    const detected = decideStatus(rows);

    const saved = await getSaved(supabase, chatId);

    let final = detected;
    let updated_at = saved?.updated_at || null;

    if (saved?.status){
      if (saved.status !== detected){
        if (canUpgrade(saved.status, detected)){
          const touch = (detected === 'SoW signed' && saved.status !== 'SoW signed');
          const storedAt = await saveStatus(supabase, chatId, detected, {
            touchSoWTime: touch,
            existingUpdatedAt: saved.updated_at ?? null,
          });
          updated_at = storedAt;
          final = detected;
        } else {
          final = saved.status; // keep manual or previous (no downgrade)
        }
      } else {
        final = saved.status;
      }
    } else {
      const touch = (detected === 'SoW signed');
      const storedAt = await saveStatus(supabase, chatId, detected, {
        touchSoWTime: touch,
        existingUpdatedAt: null,
      });
      updated_at = storedAt;
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
