// api/chats.js
// Returns chats + current status and grant assignments for dashboard filters.

import { q } from './_db.js';
import { verifyTelegramInitData } from './_tg.js';

const GRANT_OPTIONS = new Set(['MultiversX', 'TON', 'Fastex', 'BNB Chain']);

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const initData = req.headers['x-telegram-init-data'] || req.query.init_data || '';
    const ok = verifyTelegramInitData(initData);
    if (!ok) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  } catch (err) {
    res.status(401).json({ error: 'auth_failed', details: err?.message || String(err) });
    return;
  }

  const statusRaw = (req.query.status || '').trim();
  const grantRaw = (req.query.grant || '').trim();

  const statusFilter = statusRaw && statusRaw.toLowerCase() !== 'all' && statusRaw.toLowerCase() !== 'all statuses'
    ? statusRaw
    : null;
  const grantFilter = grantRaw && grantRaw.toLowerCase() !== 'all'
    ? (GRANT_OPTIONS.has(grantRaw) ? grantRaw : null)
    : null;

  try {
    const { rows } = await q(
      `SELECT
         c.id,
         c.title,
         c.username,
         c.is_megagroup,
         c.last_synced_at,
         s.status,
         s.updated_at AS status_updated_at,
         CASE
           WHEN s.status = 'SoW signed' AND s.updated_at IS NOT NULL
           THEN FLOOR(EXTRACT(EPOCH FROM (now() - s.updated_at))/86400)::int
           ELSE NULL
         END AS sow_days,
         cg.program_id AS grant_id,
         gp.name AS grant_name
       FROM chats c
       LEFT JOIN chat_status s ON s.chat_id = c.id
       LEFT JOIN public.chat_grants cg ON cg.chat_tg_id = c.id
       LEFT JOIN public.grant_programs gp ON gp.id = cg.program_id
       WHERE ($1::text IS NULL OR s.status = $1)
         AND ($2::text IS NULL OR gp.name = $2)
       ORDER BY c.last_synced_at DESC NULLS LAST, c.id DESC
       LIMIT 1000`,
      [statusFilter, grantFilter]
    );

    const chats = rows.map(row => ({
      id: row.id,
      title: row.title,
      username: row.username,
      is_megagroup: row.is_megagroup,
      last_synced_at: row.last_synced_at,
      status: row.status,
      status_updated_at: row.status_updated_at,
      sow_days: row.sow_days,
      grant: row.grant_id && row.grant_name ? { id: row.grant_id, name: row.grant_name } : null,
      grant_id: row.grant_id,
      grant_name: row.grant_name
    }));

    res.status(200).json({ chats });
  } catch (err) {
    console.error('chats query failed', err);
    res.status(500).json({ error: 'db_failed', details: err?.message || String(err) });
  }
}
