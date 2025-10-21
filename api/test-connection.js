import { getSupabase } from "./_utils/supabase.js";

export default async function handler(req, res) {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from("chats").select("*").limit(1);

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    return res.status(200).json({ data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
