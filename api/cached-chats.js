// api/cached-chats.js

import { getSupabase } from "@/api/_utils/supabase";

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 🛡️ Validate Telegram headers
  const usernameHeader = req.headers['x-telegram-username'];
  const idHeader = req.headers['x-telegram-id'];
  const tgUsername = (Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader)
    ?.replace('@', '')
    ?.toLowerCase();
  const tgUserId = Array.isArray(idHeader) ? idHeader[0] : idHeader;

  if (!tgUsername || !tgUserId) {
    return res.status(401).json({ error: 'Unauthorized access: missing Telegram identity' });
  }

  // ⚠️ Safe Supabase client creation
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    console.error('❌ Supabase client init failed:', err);
    return res.status(500).json({ error: 'Supabase client init failed' });
  }

  // ✅ Check if user is in `team_members`
  try {
    const { data: members = [], error: memberError } = await supabase
      .from('team_members')
      .select('tg_username')
      .eq('tg_username', tgUsername)
      .limit(1);

    if (memberError) {
      console.error('❌ Error checking team member:', memberError);
      return res.status(500).json({ error: 'Error verifying team membership' });
    }

    if (members.length === 0) {
      return res.status(401).json({ error: 'Unauthorized access: not a team member' });
    }
  } catch (err) {
    console.error('❌ Team membership check failed:', err);
    return res.status(500).json({ error: 'Team member check failed' });
  }

  // 📦 Fetch cached chats
  try {
    const { data, error } = await supabase
      .from('cached_chats')
      .select('chat_id, title, username')
      .order('chat_id', { ascending: false })
      .limit(2000);

    if (error) {
      if (error?.code === '42P01') {
        // Table doesn't exist
        console.warn('⚠️ cached_chats table missing:', error?.message || error);
        return res.status(200).json([]);
      }

      console.error('❌ Supabase error loading cached_chats:', error?.message || error);
      return res.status(500).json({ error: 'Failed to load cached chats' });
    }

    return res.status(200).json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('❌ Unexpected error loading cached chats:', err);
    return res.status(500).json({ error: 'Failed to load cached chats' });
  }
}
