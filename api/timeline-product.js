// api/timeline-product.js
// Returns [{label, month, day, chat_id, title}] for product/service/site launches.

export default async function handler(req, res){
  try{
    const db = await import('./_db.js');
    const common = await import('./_timeline_common.js');

    const { rows } = await db.q(`
      select m.chat_id, c.title, m.date, m.text
      from messages m
      join chats c on c.id = m.chat_id
      where m.text is not null
      order by m.date desc
      limit 20000
    `);

    const data = common.buildTimelineFromRows(rows, 'product');
    res.json({ items: data });
  }catch(e){
    res.status(500).json({ error:e?.message||'server error' });
  }
}
