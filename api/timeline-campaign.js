// api/timeline-campaign.js
// Returns [{label, month, day, chat_id, title}] for campaign launch mentions.

import { getSupabase } from './_utils/supabase.js';
import { buildTimelineFromRows } from './_timeline_common.js';

export default async function handler(req, res){
  try{
    const supabase = getSupabase();

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

    const items = buildTimelineFromRows(rows, 'campaign');
    res.json({ items });
  }catch(e){
    console.error('timeline-campaign error:', e);
    res.status(500).json({ error:e?.message||'server error' });
  }
}
