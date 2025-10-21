// api/blurb-get.js
// Returns a chat blurb from manual overrides or the auto-generated view.

import { q } from './_db.js';

export default async function handler(req, res) {
  try {
    const chatId = req.query.chat_id;
    if (!chatId) {
      return res.status(400).json({ error: 'chat_id required' });
    }

    // 1) Manual override wins.
    const { rows: overrideRows } = await q(
      `select blurb from project_meta where chat_id = $1 limit 1`,
      [chatId]
    );
    const manual = overrideRows?.[0]?.blurb;
    if (manual) {
      return res.status(200).json({ blurb: manual, source: 'manual' });
    }

    // 2) Otherwise fall back to the auto-generated candidate view.
    const { rows: autoRows } = await q(
      `select blurb, date
         from v_candidate_blurbs
        where chat_id = $1
        order by date desc
        limit 1`,
      [chatId]
    );
    const auto = autoRows?.[0]?.blurb;
    if (auto) {
      return res.status(200).json({ blurb: auto, source: 'auto' });
    }

    return res.status(200).json({ blurb: '', source: 'none' });
  } catch (e) {
    console.error('blurb-get error:', e);
    return res.status(500).json({ error: 'server error' });
  }
}
