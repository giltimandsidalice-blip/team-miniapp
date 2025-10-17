import { q } from './_db.js';
import { verifyTelegramInitData } from './_tg.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

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

  try {
    const result = await q('select id, name from public.grant_programs order by name');
    res.status(200).json({ grants: result.rows });
  } catch (err) {
    console.error('grants query failed', err);
    res.status(500).json({ error: 'db_error', details: err?.message || String(err) });
  }
}
