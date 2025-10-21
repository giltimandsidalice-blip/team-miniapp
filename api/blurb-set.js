// api/blurb-set.js
// Saves a manual blurb override for a chat.

import { getSupabase } from './_utils/supabase.js';

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

    const supabase = getSupabase();

    const payload = {
      chat_id: chatId,
      blurb: blurb || '',
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('project_meta')
      .upsert(payload, { onConflict: 'chat_id' });

    if (error) {
      console.error('blurb-set upsert error:', error);
      return res.status(500).json({ error: 'server error' });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('blurb-set error:', e);
    return res.status(500).json({ error: 'server error' });
  }
}
