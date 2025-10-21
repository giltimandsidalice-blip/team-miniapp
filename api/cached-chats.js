// api/cached-chats.js

import { getSupabase } from "./_utils/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const usernameHeader = req.headers["x-telegram-username"];
  const idHeader = req.headers["x-telegram-id"];

  const tgUsername = (
    Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader
  )
    ?.replace("@", "")
    ?.toLowerCase();

  const tgUserId = Array.isArray(idHeader) ? idHeader[0] : idHeader;

  if (!tgUsername || !tgUserId) {
    console.warn("Missing Telegram headers", { tgUsername, tgUserId });
    return res.status(401).json({ error: "Unauthorized: missing identity headers" });
  }

  try {
    const supabase = getSupabase();

    const { data: members, error: memberError } = await supabase
      .from("team_members")
      .select("tg_username")
      .eq("tg_username", tgUsername)
      .limit(1);

    if (memberError) {
      console.error("Failed to check team member:", memberError.message);
      return res.status(500).json({ error: "Failed to verify team membership" });
    }

    if (!members || members.length === 0) {
      return res.status(401).json({ error: "Unauthorized: not a team member" });
    }

    const { data, error } = await supabase
      .from("cached_chats")
      .select("chat_id, title, username")
      .order("chat_id", { ascending: false })
      .limit(2000);

    if (error) {
      console.error("Supabase select error:", error.message);
      return res.status(500).json({ error: "Failed to load cached chats" });
    }

    if (!data) {
      console.warn("No data returned from cached_chats");
      return res.status(200).json([]);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in cached-chats handler:", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}
