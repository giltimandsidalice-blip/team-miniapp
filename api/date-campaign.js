// api/date-campaign.js
// Extracts a probable campaign launch date from one chat.

export default async function handler(req, res){
  try{
    const chatId = req.query.chat_id;
    if(!chatId) return res.status(400).json({ error:'chat_id required' });

    const db = await import('./_db.js');
    const { rows } = await db.q(
      `select date, text from messages
       where chat_id=$1 and text is not null
       order by date desc limit 400`, [chatId]);

    const date = extractDate(rows.map(r=>r.text));
    res.json({ date: date || 'Unknown' });
  }catch(e){
    res.status(500).json({ error:e?.message||'server error' });
  }
}

function extractDate(texts){
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const monthIdx = (w)=>MONTHS.indexOf(w.toLowerCase())+1 || null;

  const candidates = [];
  for(const t of texts){
    const low = t.toLowerCase();

    // Only consider campaign mentions
    if (!/(campaign|promo|ads|kol.*campaign|marketing campaign)/i.test(low)) continue;

    // dd.mm
    const m1 = low.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
    if (m1){
      const d = parseInt(m1[1],10), m = parseInt(m1[2],10);
      if (m>=1 && m<=12 && d>=1 && d<=31) candidates.push({ y:null, m, d });
    }

    // Month words
    const m2 = low.match(/\b(\d{1,2})\s+([A-Za-z]+)\b/);
    const m3 = low.match(/\b([A-Za-z]+)\s+(\d{1,2})\b/);
    const m4 = low.match(/\b(in|on|around)\s+([A-Za-z]+)\b/);
    if (m2 && monthIdx(m2[2])) candidates.push({ y:null, m:monthIdx(m2[2]), d:parseInt(m2[1],10) });
    if (m3 && monthIdx(m3[1])) candidates.push({ y:null, m:monthIdx(m3[1]), d:parseInt(m3[2],10) });
    if (m4 && monthIdx(m4[2])) candidates.push({ y:null, m:monthIdx(m4[2]), d:null });
  }

  const last = candidates[0] || null;
  if (!last) return null;

  const mm = String(last.m).padStart(2,'0');
  if (last.d) {
    const dd = String(last.d).padStart(2,'0');
    return `${dd}.${mm}`;
  }
  return `xx.${mm}`;
}
