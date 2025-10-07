// api/chats.js (ESM)
// Returns chats with manual status if set; includes status_updated_at.
// Safe if the table didn't exist before (status will be null).

import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";

const SKIP_AUTH = false;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    if (!SKIP_AUTH) {
      const initData =
        req.headers["x-telegram-init-data"] ||
        req.query.init_data ||
        req.body?.init_data ||
        "";
      const ok = verifyTelegramInitData(initData);
      if (!ok) return res.status(401).json({ error: "unauthorized", stage: "auth" });
    }
  } catch (e) {
    return res.status(401).json({ error: `auth_failed: ${e?.message || e}`, stage: "auth" });
  }

  try {
    // Use a lateral subquery just in case there are multiple rows per chat in the future.
    const { rows } = await q(`
      with s as (
        select cs.chat_id, cs.status, cs.updated_at
        from chat_status cs
      )
      select
        c.id,
        c.title,
        c.username,
        c.is_megagroup,
        c.last_synced_at,
        s.status,
        s.updated_at as status_updated_at
      from chats c
      left join s on s.chat_id = c.id::bigint
      order by c.last_synced_at desc nulls last, c.id desc
      limit 500;
    `);

    // Normalize to what your front-end expects
    const out = (rows || []).map(r => ({
      id: r.id,
      title: r.title,
      username: r.username,
      is_megagroup: r.is_megagroup,
      last_synced_at: r.last_synced_at,
      status: r.status ?? null,
      status_updated_at: r.status_updated_at ?? null
    }));

    return res.json(out);
  } catch (e) {
    // If chat_status doesn’t exist yet, we still want chats to load.
    const msg = e?.message || String(e);
    if (msg.includes("relation") && msg.includes("chat_status")) {
      // return chats without status fields
      const { rows: base } = await q(`
        select id, title, username, is_megagroup, last_synced_at
        from chats
        order by last_synced_at desc nulls last, id desc
        limit 500;
      `);
      return res.json(base || []);
    }
    return res.status(500).json({ error: `db_failed: ${msg}`, stage: "db" });
  }
}
