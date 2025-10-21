// api/timeline-product.js
// Returns [{label, month, day, chat_id, title}] for product/service/site launches.

import { getSupabase } from "./_utils/supabase.js";
import { buildTimelineFromRows } from './_timeline_common.js';

export default async function handler(req, res){
  const usernameHeader = req.headers['x-telegram-username'];
  const idHeader = req.headers['x-telegram-id'];
  const tgUsername = (Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader)?.replace('@', '')?.toLowerCase();
  const tgUserId = Array.isArray(idHeader) ? idHeader[0] : idHeader;

  if (!tgUsername || !tgUserId) {
    return res.status(401).json({ error: 'Unauthorized access: missing Telegram identity' });
  }

  try{
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
      .from('messages')
      .select('chat_id, date, text, chats!inner(title)')
      .not('text', 'is', null)
      .order('date', { ascending: false })
      .range(0, 19999);

    if (error){
      throw error;
    }

    const rows = (data || [])
      .map(row => ({
        chat_id: row.chat_id,
        title: row.chats?.title ?? null,
        date: row.date,
        text: row.text,
      }))
      .filter(row => row.title);

    const items = buildTimelineFromRows(rows, 'product');
    res.json({ items });
  }catch(e){
    console.error('timeline-product error:', e);
    res.status(500).json({ error:e?.message||'server error' });
  }
}
