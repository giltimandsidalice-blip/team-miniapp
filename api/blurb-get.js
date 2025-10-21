// api/blurb-get.js
// Returns a chat blurb from manual overrides or the auto-generated view.

import { getSupabase } from "@/api/_utils/supabase";

export default async function handler(req, res) {
  const usernameHeader = req.headers['x-telegram-username'];
  const idHeader = req.headers['x-telegram-id'];
  const tgUsername = (Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader)?.replace('@', '')?.toLowerCase();
  const tgUserId = Array.isArray(idHeader) ? idHeader[0] : idHeader;

  if (!tgUsername || !tgUserId) {
    return res.status(401).json({ error: 'Unauthorized access: missing Telegram identity' });
  }
  try {
    const chatId = req.query.chat_id;
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
    
    // 1) Manual override wins.
    const { data: override, error: overrideError } = await supabase
      .from('project_meta')
      .select('blurb')
      .eq('chat_id', chatId)
      .limit(1)
      .maybeSingle();

    if (overrideError && overrideError.code !== 'PGRST116') {
      console.error('blurb-get manual override error:', overrideError);
      return res.status(500).json({ error: 'server error' });
    }

    const manual = override?.blurb;
    if (manual) {
      return res.status(200).json({ blurb: manual, source: 'manual' });
    }

    // 2) Otherwise fall back to the auto-generated candidate view.
    const { data: autoData, error: autoError } = await supabase
      .from('v_candidate_blurbs')
      .select('blurb, date')
      .eq('chat_id', chatId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (autoError && autoError.code !== 'PGRST116') {
      console.error('blurb-get auto blurb error:', autoError);
      return res.status(500).json({ error: 'server error' });
    }

    const auto = autoData?.blurb;
    if (auto) {
      return res.status(200).json({ blurb: auto, source: 'auto' });
    }

    console.warn('blurb-get: no blurb found – possible RLS block for chat', chatId);
    return res.status(200).json({ blurb: '', source: 'none' });
  } catch (e) {
    console.error('blurb-get error:', e);
    return res.status(500).json({ error: 'server error' });
  }
}
