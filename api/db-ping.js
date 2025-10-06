// api/db-ping.js
import { q } from "./_db";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const r = await q("select now() as now");
    return res.json({ ok: true, now: r.rows?.[0]?.now || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
