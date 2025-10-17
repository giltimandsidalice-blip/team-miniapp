import { getSupabase } from './_utils/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sb = getSupabase();
  if (!sb) {
    console.error('cached-chats GET missing Supabase configuration');
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { data, error } = await sb
      .from('cached_chats')
      .select('chat_id, title, username')
      .order('chat_id', { ascending: false })
      .limit(2000);

    if (error) {
      const message = error?.message || '';
      if (error?.code === '42P01' || /cached_chats/i.test(message)) {
        console.warn('cached-chats GET missing table:', message || error?.code);
        return res.status(200).json([]);
      }
      console.error('cached-chats GET Supabase error:', message || error);
      return res.status(500).json({ error: 'Failed to load cached chats' });
    }

    return res.status(200).json(Array.isArray(data) ? data : []);
  } catch (err) {
    if (err?.code === '42P01') {
      console.warn('cached-chats GET missing table:', err?.message || err);
      return res.status(200).json([]);
    }
    console.error('cached-chats GET error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to load cached chats' });
  }
}
