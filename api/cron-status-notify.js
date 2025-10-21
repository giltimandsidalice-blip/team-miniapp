// api/cron-status-notify.js
// Sends automatic reminders to TEAM chat when a chat has been "SoW signed" for 1, 3, or 5 days.
// Runs on a schedule via Vercel "cron". Requires:
//   - BOT_TOKEN         (same bot you already use for the MiniApp)
//   - TEAM_CHAT_ID      (e.g. -1002976490821)

// simple pg import (dynamic to avoid cold-start crashes)
async function getDb() {
  try {
    const db = await import('./_db.js').catch(e => ({ __err: e }));
    if (db?.__err) throw db.__err;
    return db;
  } catch (e) {
    throw new Error(`import_db_failed: ${e?.message || e}`);
  }
}

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

    const { q, pool } = await getDb();

    // 1) Find chats in "SoW signed" and compute days since updated_at
    //    We only care about day markers 1,3,5
    const { rows } = await q(`
      with s as (
        select
          cs.chat_id,
          cs.status,
          cs.updated_at,
          greatest(0, floor(extract(epoch from (now() - cs.updated_at)) / 86400))::int as since_days
        from chat_status cs
        where cs.status = 'SoW signed'
      )
      select
        s.chat_id,
        s.since_days,
        c.title
      from s
      join chats c on c.id = s.chat_id
      where s.since_days in (1,3,5)
      order by s.since_days asc, c.title asc
    `);

    if (!rows?.length) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;

    for (const r of rows) {
      const chatId = r.chat_id;
      const title  = r.title || String(chatId);
      const day    = Number(r.since_days) || 0;

      // 2) Check if we already notified for this (chat_id, 'SoW signed', day_marker)
      const exists = await q(
        `select 1 from status_notifications where chat_id=$1 and status=$2 and day_marker=$3 limit 1`,
        [chatId, 'SoW signed', day]
      );
      if (exists.rowCount > 0) continue; // already sent

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
      await q(
        `insert into status_notifications (chat_id, status, day_marker) values ($1,$2,$3)
         on conflict (chat_id, status, day_marker) do nothing`,
        [chatId, 'SoW signed', day]
      );
      sent++;
    }

    res.json({ ok: true, sent });
  } catch (e) {
    console.error('cron-status-notify error:', e);
    res.status(500).json({ error: e?.message || 'server error' });
  }
}
