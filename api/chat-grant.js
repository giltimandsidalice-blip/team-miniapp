import { q } from './_db.js';
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

async function fetchAssignment(chatId) {
  const { rows } = await q(
    `select cg.chat_tg_id, cg.program_id, gp.name as program_name, cg.assigned_at
     from public.chat_grants cg
     left join public.grant_programs gp on gp.id = cg.program_id
     where cg.chat_tg_id = $1`,
    [chatId]
  );
  return rows[0] || null;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  if (!(await ensureAuthorized(req, res))) return;

  const chatIdRaw = req.body?.chat_tg_id ?? req.query?.chat_tg_id;
  if (!chatIdRaw) {
    res.status(400).json({ error: 'missing_chat_tg_id' });
    return;
  }

  const chatId = String(chatIdRaw);

  if (req.method === 'DELETE') {
    try {
      await q('delete from public.chat_grants where chat_tg_id = $1', [chatId]);
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
    const check = await q('select id from public.grant_programs where id = $1', [programId]);
    if (!check.rows.length) {
      res.status(400).json({ error: 'invalid_program' });
      return;
    }

    await q(
      `insert into public.chat_grants (chat_tg_id, program_id, assigned_at)
       values ($1, $2, now())
       on conflict (chat_tg_id)
       do update set program_id = excluded.program_id, assigned_at = now()`,
      [chatId, programId]
    );

    const assignment = await fetchAssignment(chatId);
    res.status(200).json({ assignment });
  } catch (err) {
    console.error('upsert chat grant failed', err);
    res.status(500).json({ error: 'db_error', details: err?.message || String(err) });
  }
}
