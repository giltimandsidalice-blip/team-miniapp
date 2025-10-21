// api/cron-status-notify.js
// Sends automatic reminders to TEAM chat when a chat has been "SoW signed" for 1, 3, or 5 days.
// Runs on a schedule via Vercel "cron". Requires:
//   - BOT_TOKEN         (same bot you already use for the MiniApp)
//   - TEAM_CHAT_ID      (e.g. -1002976490821)

import { getSupabase } from "@/api/_utils/supabase";

async function sendTeamMessage(text) {
  const token = process.env.BOT_TOKEN;
  const teamChatId = process.env.TEAM_CHAT_ID;
  if (!token || !String(token).trim()) throw new Error('BOT_TOKEN missing');
  if (!teamChatId || !String(teamChatId).trim()) throw new Error('TEAM_CHAT_ID missing');
  const normalizedChatId = String(teamChatId).trim();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: normalizedChatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    throw new Error(`telegram_send_failed: ${j?.description || r.statusText}`);
  }
}

// format helper: "SoW <chat title> was signed 1 day ago"
function buildText(day, chatTitle) {
  const dayStr = day === 1 ? '1 day' : `${day} days`;
  return `SoW ${chatTitle} was signed ${dayStr} ago`;
}

// MAIN
export default async function handler(req, res) {
  try {
    // Only allow internal/cron calls (optional: you can add a secret header if you want)
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const usernameHeader = req.headers['x-telegram-username'];
    const idHeader = req.headers['x-telegram-id'];
    const tgUsername = (Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader)?.replace('@', '')?.toLowerCase();
    const tgUserId = Array.isArray(idHeader) ? idHeader[0] : idHeader;

    if (!tgUsername || !tgUserId) {
      return res.status(401).json({ error: 'Unauthorized access: missing Telegram identity' });
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
    const { data: statusRows, error: statusError } = await supabase
      .from('chat_status')
      .select('chat_id, updated_at')
      .eq('status', 'SoW signed');

    if (statusError) {
      throw statusError;
    }

    const chatIds = Array.from(
      new Set(
        (statusRows || [])
          .map(row => row.chat_id)
          .filter(chatId => chatId !== null && chatId !== undefined)
      )
    );

    let titlesById = new Map();
    if (chatIds.length > 0) {
      const { data: chats, error: chatsError } = await supabase
        .from('chats')
        .select('id, title')
        .in('id', chatIds);

      if (chatsError) {
        throw chatsError;
      }

      for (const chat of chats || []) {
        titlesById.set(chat.id, chat.title || null);
      }
    }

    const now = Date.now();
    const targets = [];

    for (const row of statusRows || []) {
      const chatId = row.chat_id;
      if (chatId === null || chatId === undefined) continue;
      const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
      if (!updatedAt || Number.isNaN(updatedAt.getTime())) continue;

      const diffMs = Math.max(0, now - updatedAt.getTime());
      const sinceDays = Math.max(0, Math.floor(diffMs / 86400000));

      if (![1, 3, 5].includes(sinceDays)) continue;

      const title = titlesById.get(chatId) || String(chatId);
      targets.push({ chatId, sinceDays, title });
    }

    targets.sort((a, b) => {
      if (a.sinceDays !== b.sinceDays) {
        return a.sinceDays - b.sinceDays;
      }
      return a.title.localeCompare(b.title);
    });

    if (!targets.length) {
      return res.json({ ok: true, sent: 0 });
    }

    const uniqueChatIds = Array.from(new Set(targets.map(t => t.chatId)));

    let existingSet = new Set();
    if (uniqueChatIds.length > 0) {
      const { data: existing, error: existingError } = await supabase
        .from('status_notifications')
        .select('chat_id, day_marker')
        .eq('status', 'SoW signed')
        .in('chat_id', uniqueChatIds)
        .in('day_marker', [1, 3, 5]);

      if (existingError) {
        throw existingError;
      }

      for (const row of existing || []) {
        existingSet.add(`${row.chat_id}:${row.day_marker}`);
      }
    }

    let sent = 0;

    for (const target of targets) {
      const chatId = target.chatId;
      const title = target.title;
      const day = target.sinceDays;

      // 2) Check if we already notified for this (chat_id, 'SoW signed', day_marker)
      if (existingSet.has(`${chatId}:${day}`)) continue; // already sent

      // 3) Send message to team chat
      const text = buildText(day, title);
      try {
        await sendTeamMessage(text);
      } catch (e) {
        // if Telegram fails, skip inserting tracker so we try again next run
        console.error('send error:', e?.message || e);
        continue;
      }

      // 4) Record we sent it
      const { error: insertError } = await supabase
        .from('status_notifications')
        .upsert(
          {
            chat_id: chatId,
            status: 'SoW signed',
            day_marker: day,
          },
          { onConflict: 'chat_id,status,day_marker' }
        );

      if (insertError) {
        console.error('status notification insert failed:', insertError);
        continue;
      }

      existingSet.add(`${chatId}:${day}`);
      sent++;
    }

    res.json({ ok: true, sent });
  } catch (e) {
    console.error('cron-status-notify error:', e);
    res.status(500).json({ error: e?.message || 'server error' });
  }
}
