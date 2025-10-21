import { getSupabase } from "./_utils/supabase";
import { verifyTelegramInitData } from './_tg.js';

async function ensureAuthorized(req, res) {
  try {
    const initData = req.headers['x-telegram-init-data'] || req.query.init_data || req.body?.init_data || '';
    const ok = verifyTelegramInitData(initData);
    if (!ok) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  } catch (err) {
    res.status(401).json({ error: 'auth_failed', details: err?.message || String(err) });
    return false;
  }
}

function extractProgramName(grantPrograms) {
  if (!grantPrograms) return null;
  if (Array.isArray(grantPrograms)) {
    return grantPrograms[0]?.name ?? null;
  }
  return grantPrograms.name ?? null;
}

async function fetchAssignment(supabase, chatId) {
  const { data, error } = await supabase
    .from('chat_grants')
    .select('chat_tg_id, program_id, assigned_at, grant_programs(name)')
    .eq('chat_tg_id', chatId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) return null;

  return {
    chat_tg_id: data.chat_tg_id,
    program_id: data.program_id,
    assigned_at: data.assigned_at,
    program_name: extractProgramName(data.grant_programs),
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  if (!(await ensureAuthorized(req, res))) return;

  const usernameHeader = req.headers['x-telegram-username'];
  const idHeader = req.headers['x-telegram-id'];
  const tgUsername = (Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader)?.replace('@', '')?.toLowerCase();
  const tgUserId = Array.isArray(idHeader) ? idHeader[0] : idHeader;

  if (!tgUsername || !tgUserId) {
    res.status(401).json({ error: 'Unauthorized access: missing Telegram identity' });
    return;
  }
  
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    console.error('chat-grant Supabase init error', err);
    res.status(500).json({ error: 'supabase_unavailable', details: err?.message || String(err) });
    return;
  }
  
  const { data: members = [], error: memberError } = await supabase
    .from('team_members')
    .select('tg_username')
    .eq('tg_username', tgUsername)
    .limit(1);

  if (memberError || members.length === 0) {
    res.status(401).json({ error: 'Unauthorized access: not a team member' });
    return;
  }
  
  const chatIdRaw = req.body?.chat_tg_id ?? req.query?.chat_tg_id;
  if (!chatIdRaw) {
    res.status(400).json({ error: 'missing_chat_tg_id' });
    return;
  }

  const chatId = String(chatIdRaw);

  if (req.method === 'DELETE') {
    try {
      const { error } = await supabase
        .from('chat_grants')
        .delete()
        .eq('chat_tg_id', chatId);

      if (error) {
        throw error;
      }

      res.status(200).json({ assignment: null });
    } catch (err) {
      console.error('delete chat grant failed', err);
      res.status(500).json({ error: 'db_error', details: err?.message || String(err) });
    }
    return;
  }

  const { program_id: programIdRaw } = req.body || {};
  if (!programIdRaw) {
    res.status(400).json({ error: 'missing_program_id' });
    return;
  }

  const programId = Number(programIdRaw);
  if (!Number.isInteger(programId)) {
    res.status(400).json({ error: 'invalid_program' });
    return;
  }

  try {
    const { data: program, error: programError } = await supabase
      .from('grant_programs')
      .select('id')
      .eq('id', programId)
      .maybeSingle();

    if (programError) {
      console.error('verify grant program failed', programError);
      res.status(500).json({ error: 'db_error', details: programError?.message || String(programError) });
      return;
    }

    if (!program) {
      res.status(400).json({ error: 'invalid_program' });
      return;
    }

    const { error: upsertError } = await supabase
      .from('chat_grants')
      .upsert(
        {
          chat_tg_id: chatId,
          program_id: programId,
          assigned_at: new Date().toISOString(),
        },
        { onConflict: 'chat_tg_id' }
      );

    if (upsertError) {
      throw upsertError;
    }

    const assignment = await fetchAssignment(supabase, chatId);
    res.status(200).json({ assignment });
  } catch (err) {
    console.error('upsert chat grant failed', err);
    res.status(500).json({ error: 'db_error', details: err?.message || String(err) });
  }
}
