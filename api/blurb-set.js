// api/blurb-set.js
// Saves a manual blurb override for a chat.

import { getSupabase } from "./_utils/supabase.js";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  const usernameHeader = req.headers['x-telegram-username'];
  const idHeader = req.headers['x-telegram-id'];
  const tgUsername = (Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader)?.replace('@', '')?.toLowerCase();
  const tgUserId = Array.isArray(idHeader) ? idHeader[0] : idHeader;

  if (!tgUsername || !tgUserId) {
    return res.status(401).json({ error: 'Unauthorized access: missing Telegram identity' });
  }

    try {
    const { chat_id: chatId, blurb } = req.body || {};
    if (!chatId) {
      return res.status(400).json({ error: 'chat_id required' });
    }

    const supabase = getSupabase();
    const { data: members = [], error: memberError } = await supabase
      .from('team_members')
      .select('tg_username')
      .eq('tg_username', tgUsername)
      .limit(1);

    if (memberError || members.length === 0) {
      return res.status(401).json({ error: 'Unauthorized access: not a team member' });
    }

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
