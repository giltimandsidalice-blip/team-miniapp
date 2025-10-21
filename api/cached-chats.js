// api/cached-chats.js

import { getSupabase } from "@/api/_utils/supabase";

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const usernameHeader = req.headers['x-telegram-username'];
  const idHeader = req.headers['x-telegram-id'];
  const tgUsername = (Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader)?.replace('@', '')?.toLowerCase();
  const tgUserId = Array.isArray(idHeader) ? idHeader[0] : idHeader;

  if (!tgUsername || !tgUserId) {
    return res.status(401).json({ error: 'Unauthorized access: missing Telegram identity' });
  }

  try {
    const supabase = getSupabase();

    const { data: members = [], error: memberError } = await supabase
      .from('team_members')
      .select('tg_username')
      .eq('tg_username', tgUsername)
      .limit(1);

    if (memberError || members.length === 0) {
      return res.status(401).json({ error: 'Unauthorized access: not a team member' });
    }

    const { data, error } = await supabase
      .from('cached_chats')
      .select('chat_id, title, username')
      .order('chat_id', { ascending: false })
      .limit(2000);

    if (error) {
      if (error?.code === '42P01') {
        console.warn('cached-chats GET missing table:', error?.message || error);
        return res.status(200).json([]);
      }

      console.error('cached-chats GET error:', error?.message || error);
      return res.status(500).json({ error: error?.message || String(error) });
    }

    return res.status(200).json(Array.isArray(data) ? data : []);
  } catch (err) {
    if (err?.code === '42P01') {
      console.warn('cached-chats GET missing table:', err?.message || err);
      return res.status(200).json([]);
    }

    console.error('cached-chats GET error:', err?.message || err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
