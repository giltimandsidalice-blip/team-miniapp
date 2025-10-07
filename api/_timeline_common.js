// api/_timeline_common.js
// Shared logic for building timelines from recent messages.

export function monthNameToNum(w){
  const m = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const i = m.indexOf((w||'').toLowerCase());
  return i>=0 ? i+1 : null;
}

function pickDate(text, kind){
  const t = (text||'').toLowerCase();

  // Gate by kind
  if (kind === 'product') {
    if (!/(product|service|site|website|platform|app|release|go live|launch)/i.test(t)) return null;
    if (/campaign/i.test(t)) return null; // avoid campaign mentions in product timeline
  } else {
    if (!/(campaign|promo|ads|kol.*campaign|marketing campaign|posts are live|went live)/i.test(t)) return null;
  }

  // dd.mm or d.m
  let m;
  m = t.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (m){
    const d = parseInt(m[1],10), mm = parseInt(m[2],10);
    if (mm>=1 && mm<=12 && d>=1 && d<=31) return { m:mm, d };
  }

  // "12 October" / "October 12" / "in October"
  m = t.match(/\b(\d{1,2})\s+([A-Za-z]+)\b/);
  if (m){
    const mm = monthNameToNum(m[2]); const d = parseInt(m[1],10);
    if (mm) return { m:mm, d };
  }
  m = t.match(/\b([A-Za-z]+)\s+(\d{1,2})\b/);
  if (m){
    const mm = monthNameToNum(m[1]); const d = parseInt(m[2],10);
    if (mm) return { m:mm, d };
  }
  m = t.match(/\b(in|on|around)\s+([A-Za-z]+)\b/);
  if (m){
    const mm = monthNameToNum(m[2]);
    if (mm) return { m:mm, d:null }; // “xx.mm”
  }
  return null;
}

export function buildTimelineFromRows(rows, kind){
  // One best date per chat (take first match while scanning from latest → oldest)
  const best = new Map();
  for (const r of rows){
    const pd = pickDate(r.text, kind);
    if (pd && !best.has(r.chat_id)) best.set(r.chat_id, { ...pd, chat_id:r.chat_id, title:r.title });
  }
  const arr = Array.from(best.values()).map(x=>{
    const month = x.m;
    const day   = (x.d==null? null : x.d);
    const label = `${day==null?'xx':String(day).padStart(2,'0')}.${String(month).padStart(2,'0')} - ${x.title}`;
    return { label, month, day, chat_id: x.chat_id, title: x.title };
  });
  // Sort by month asc, then day asc (null days last within that month)
  arr.sort((a,b)=>{
    if (a.month!==b.month) return a.month - b.month;
    const ad = a.day==null ? 999 : a.day;
    const bd = b.day==null ? 999 : b.day;
    return ad - bd;
  });
  return arr;
}
