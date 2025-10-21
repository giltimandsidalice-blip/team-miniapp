// api/blurb-set.js
// Saves a manual blurb override for a chat.

import { q } from './_db.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'POST only' });
    }

    const { chat_id: chatId, blurb } = req.body || {};
    if (!chatId) {
      return res.status(400).json({ error: 'chat_id required' });
    }

    await q(
      `insert into project_meta (chat_id, blurb, updated_at)
       values ($1, $2, now())
       on conflict (chat_id) do update
         set blurb = excluded.blurb,
             updated_at = now()`,
      [chatId, blurb || '']
    );

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('blurb-set error:', e);
    return res.status(500).json({ error: 'server error' });
  }
}
