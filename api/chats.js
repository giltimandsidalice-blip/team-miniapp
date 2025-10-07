// api/chats.js (ESM)
// Returns chats with both manual status (from chat_status)
// and an auto status computed from recent messages (heuristics).
// Also supports ?limit=1000

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

  const limit = Math.min(parseInt(req.query.limit || "1000", 10), 2000);

  try {
    // Aggregate a light "blob" of text per chat and classify with CASE rules.
    const { rows } = await q(
      `
      with recent as (
        select m.chat_id,
               string_agg(lower(left(coalesce(m.text,''), 400)), ' ') as blob
        from messages m
        where m.text is not null
        group by m.chat_id
      )
      select
        c.id,
        c.title,
        c.username,
        c.is_megagroup,
        c.last_synced_at,
        s.status as status_manual,
        case
          when r.blob ~ '(sow signed|contract signed|agreement signed|counter-?signed|executed)' then 'SoW signed'
          when r.blob ~ '(awaiting payment|waiting .*payment|payment pending|send(ing)? .*invoice|invoice sent)' then 'Awaiting payment'
          when r.blob ~ '(payment received|invoice paid|paid|funds received|tx confirmed)' then 'Paid'
          when r.blob ~ '(please sign|sign the sow|sign contract|awaiting sow|waiting for sow)' then 'Awaiting SoW'
          when r.blob ~ '(kickoff|kicked off|go live|launch(ed)?|campaign live|started campaign)' then 'Campaign live'
          when r.blob ~ '(final report|delivered report|results attached|post-?mortem)' then 'Campaign finished'
          when r.blob ~ '(report due|waiting for report|awaiting report)' then 'Awaiting report'
          when r.blob ~ '(kol|influencer|creator).*(list|shortlist|select|choos)' then 'Preparing campaign'
          else 'Talking stage'
        end as status_auto
      from chats c
      left join recent r on r.chat_id = c.id::bigint
      left join chat_status s on s.chat_id = c.id::bigint
      order by c.last_synced_at desc nulls last, c.id desc
      limit $1
      `,
      [limit]
    );

    // Normalize for the UI
    const out = (rows || []).map(r => ({
      id: r.id,
      title: r.title,
      username: r.username,
      is_megagroup: r.is_megagroup,
      last_synced_at: r.last_synced_at,
      status_manual: r.status_manual ?? null,
      status_auto: r.status_auto ?? null
    }));

    return res.json(out);
  } catch (e) {
    // If messages table is empty, just return base chats
    const msg = e?.message || String(e);
    try {
      const { rows: base } = await q(`
        select id, title, username, is_megagroup, last_synced_at
        from chats
        order by last_synced_at desc nulls last, id desc
        limit $1
      `, [limit]);
      return res.json(base || []);
    } catch (e2) {
      return res.status(500).json({ error: `db_failed: ${msg}`, stage: "db" });
    }
  }
}
