// api/cached-chats.js

import { getSupabase } from "./_utils/supabase.js";

const MAX_LIMIT = 5000;

function normalizeChatRow(row) {
  if (!row || typeof row !== 'object') return null;
  const idRaw = row.chat_id ?? row.id;
  if (idRaw == null) return null;
  const chatId = String(idRaw);
  if (!chatId) return null;
  const title = typeof row.title === 'string' ? row.title : '';
  const username = typeof row.username === 'string' ? row.username : '';
  const lastSyncedAt = row.last_synced_at ?? row.lastSyncedAt ?? row.last_synced ?? null;
  return {
    chat_id: chatId,
    title,
    username,
    last_synced_at: lastSyncedAt,
  };
}

function mergeChatLists(primary = [], secondary = [], limit = 2000) {
  const map = new Map();
  const order = [];
  const push = (list = []) => {
    for (const entry of list) {
      const normalized = normalizeChatRow(entry);
      if (!normalized) continue;
      const existing = map.get(normalized.chat_id);
      if (!existing) {
        map.set(normalized.chat_id, normalized);
        order.push(normalized.chat_id);
      } else {
        if (!existing.title && normalized.title) existing.title = normalized.title;
        if (!existing.username && normalized.username) existing.username = normalized.username;
        if (!existing.last_synced_at && normalized.last_synced_at) {
          existing.last_synced_at = normalized.last_synced_at;
        }
      }
    }
  };
  push(primary);
  push(secondary);

  return order
    .map((id) => map.get(id))
    .sort((a, b) => {
      const aTimeRaw = a?.last_synced_at ? new Date(a.last_synced_at).getTime() : NaN;
      const bTimeRaw = b?.last_synced_at ? new Date(b.last_synced_at).getTime() : NaN;
      const aTime = Number.isFinite(aTimeRaw) ? aTimeRaw : 0;
      const bTime = Number.isFinite(bTimeRaw) ? bTimeRaw : 0;
      if (aTime !== bTime) return bTime - aTime;
      return String(b.chat_id).localeCompare(String(a.chat_id));
    })
    .slice(0, limit);
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limitParam = Number.parseInt(req.query?.limit ?? "", 10);
  const limit = Number.isInteger(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : 2000;
  const source = String(req.query?.source || "").toLowerCase();
  const preferLive = source === "live" || source === "fresh";
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

    let cachedRows = [];
    let liveRows = [];
    let cachedError = null;
    let liveError = null;

    if (!preferLive) {
      const { data: cached, error: cachedErr } = await supabase
        .from("cached_chats")
        .select("chat_id, title, username, last_synced_at")
        .order("chat_id", { ascending: false })
        .limit(limit);

      if (cachedErr) {
        cachedError = cachedErr;
        console.warn("cached_chats lookup failed, will fall back to live query", cachedErr.message);
      } else if (Array.isArray(cached)) {
        cachedRows = cached;
      }
    }

    if (preferLive || cachedRows.length === 0) {
      const { data: live, error: liveErr } = await supabase
        .from("chats")
        .select("id, title, username, last_synced_at")
        .order("last_synced_at", { ascending: false, nullsLast: true })
        .order("id", { ascending: false })
        .limit(limit);

    if (liveErr) {
        liveError = liveErr;
        console.error("live chats lookup failed", liveErr.message);
      } else if (Array.isArray(live)) {
        liveRows = live;
      }
    }

    if (!cachedRows.length && !liveRows.length) {
      const err = liveError || cachedError;
      if (err) {
        return res.status(500).json({ error: "Failed to load chats", details: err.message });
      }
    }

    const merged = mergeChatLists(liveRows, cachedRows, limit);
    return res.status(200).json(merged);
  } catch (err) {
    console.error("Unexpected error in cached-chats handler:", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}
