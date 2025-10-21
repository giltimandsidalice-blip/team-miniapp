import { getSupabase } from "./_utils/supabase";

export default async function handler(req, res) {
  const usernameHeader = req.headers['x-telegram-username'];
  const idHeader = req.headers['x-telegram-id'];
  const tgUsername = (Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader)?.replace('@', '')?.toLowerCase();
  const tgUserId = Array.isArray(idHeader) ? idHeader[0] : idHeader;

  if (!tgUsername || !tgUserId) {
    return res.status(401).json({ error: 'Unauthorized access: missing Telegram identity' });
  }

  try {
    const sb = getSupabase();

    const { data: members = [], error: memberError } = await sb
      .from('team_members')
      .select('tg_username')
      .eq('tg_username', tgUsername)
      .limit(1);

    if (memberError || members.length === 0) {
      return res.status(401).json({ error: 'Unauthorized access: not a team member' });
    }

    const { data, error } = await sb.from('chats').select('*').limit(1);

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    return res.status(200).json({ data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
