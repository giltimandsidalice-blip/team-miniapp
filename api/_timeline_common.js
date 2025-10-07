// api/_timeline_common.js (ESM)
// Shared helpers for timeline endpoints (product & campaign)

import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";

export const SKIP_AUTH = false; // keep auth in production

// Month maps (EN + RU)
const MONTHS = {
  en: {
    january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12,
    jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12
  },
  ru: {
    январь:1,января:1,янв:1,
    февраль:2,февраля:2,фев:2,
    март:3,марта:3,мар:3,
    апрель:4,апреля:4,апр:4,
    май:5,мая:5,
    июнь:6,июня:6,июн:6,
    июль:7,июля:7,июл:7,
    август:8,августа:8,авг:8,
    сентябрь:9,сентября:9,сен:9,сент:9,
    октябрь:10,октября:10,окт:10,
    ноябрь:11,ноября:11,ноя:11,нояб:11,
    декабрь:12,декабря:12,дек:12
  }
};

// Simple helpers
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n|0));
const pad2 = n => String(n).padStart(2, "0");

function parseExplicitDMY(text) {
  // 05.10.2025 | 5/10/25 | 5-10-2025 (assume D/M/Y or D.M.(YY)YY)
  const m = text.match(/\b(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{2,4}))?\b/);
  if (!m) return null;
  let d = clamp(+m[1],1,31);
  let mo = clamp(+m[2],1,12);
  let y = m[3] ? +m[3] : new Date().getFullYear();
  if (y < 100) y += 2000; // 25 -> 2025
  return { year: y, month: mo, day: d, dayUnknown:false };
}

function parseMonthName(text) {
  const lower = text.toLowerCase();

  // (day)? month (year)?
  // e.g., "5 October 2025", "October 2025", "в октябре", "окт 2025"
  // English first
  for (const [name, mo] of Object.entries(MONTHS.en)) {
    const re = new RegExp(`\\b(?:(\\d{1,2})\\s+)?${name}\\b(?:\\s+(\\d{4}))?`, "i");
    const m = lower.match(re);
    if (m) {
      const day = m[1] ? clamp(+m[1],1,31) : null;
      const y = m[2] ? +m[2] : new Date().getFullYear();
      return { year: y, month: mo, day: day ?? null, dayUnknown: !day };
    }
  }
  // Russian months (with genitive/short)
  for (const [name, mo] of Object.entries(MONTHS.ru)) {
    const re = new RegExp(`\\b(?:(\\d{1,2})\\s+)?${name}\\b(?:\\s+(\\d{4}))?`, "i");
    const m = lower.match(re);
    if (m) {
      const day = m[1] ? clamp(+m[1],1,31) : null;
      const y = m[2] ? +m[2] : new Date().getFullYear();
      return { year: y, month: mo, day: day ?? null, dayUnknown: !day };
    }
  }
  return null;
}

/**
 * Parse a date from message text.
 * Returns: {year, month, day|null, dayUnknown:boolean} | null
 * Only accepts explicit day or at least month mention. No "soon/next month" heuristics.
 */
export function parseDateFromText(text) {
  if (!text) return null;
  // 1) Try explicit D/M[/Y]
  const dmy = parseExplicitDMY(text);
  if (dmy) return dmy;

  // 2) Try "5 October 2025" or "October 2025" or "октября 2025"
  const mn = parseMonthName(text);
  if (mn) return mn;

  return null;
}

/**
 * Normalize into sortable object for UI.
 */
export function toTimelineItem({ chat_id, chat_title, parsed }) {
  const { year, month, day, dayUnknown } = parsed;
  const dateISO = `${year}-${pad2(month)}-${pad2(day || 1)}`; // use 1 for sorting unknown day
  return {
    chat_id,
    chat_title,
    year,
    month,
    day: day || null,
    dayUnknown: !!dayUnknown,
    dateISO
  };
}

/**
 * Fetch candidate messages and map them to timeline items using `wantFn(text)` to filter
 * product vs campaign contexts.
 */
export async function findTimelineItems({ chatIdsLimit = 1000, perChatLimit = 400, wantFn }) {
  // Pull recent text across chats
  // Join chats to get titles
  const { rows } = await q(
    `
    with msgs as (
      select m.chat_id, m.id, m.date, m.text
      from messages m
      where m.text is not null and m.is_service = false
      order by m.date desc
      limit $1
    )
    select ms.chat_id, c.title as chat_title, ms.id, ms.date, ms.text
    from msgs ms
    join chats c on c.id = ms.chat_id
    order by ms.date desc
    `,
    [chatIdsLimit * perChatLimit] // upper bound fetch
  );

  // Group by chat and keep up to perChatLimit per chat (latest first)
  const byChat = new Map();
  for (const r of rows) {
    const arr = byChat.get(r.chat_id) || [];
    if (arr.length < perChatLimit) {
      arr.push(r);
      byChat.set(r.chat_id, arr);
    }
  }

  // For each chat, scan for first message that both mentions a date AND passes wantFn
  const items = [];
  for (const [chat_id, arr] of byChat.entries()) {
    const chat_title = arr[0]?.chat_title || String(chat_id);
    for (const m of arr) {
      const text = String(m.text || "");
      if (!wantFn(text)) continue;
      const parsed = parseDateFromText(text);
      if (!parsed) continue;
      items.push(toTimelineItem({ chat_id, chat_title, parsed }));
      break; // first qualifying mention per chat is enough
    }
  }

  // Sort by month/day (unknown days go after known days within the same month)
  items.sort((a,b)=>{
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    const aUnknown = a.day == null;
    const bUnknown = b.day == null;
    if (aUnknown && !bUnknown) return 1;   // unknown day after known
    if (!aUnknown && bUnknown) return -1;
    if (!aUnknown && !bUnknown) return (a.day - b.day);
    return 0;
  });

  return items;
}

export function ensureAuth(req, res) {
  if (SKIP_AUTH) return true;
  const initData = req.headers["x-telegram-init-data"] || req.query.init_data || req.body?.init_data || "";
  const ok = verifyTelegramInitData(initData);
  if (!ok) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}
