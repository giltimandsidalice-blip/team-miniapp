// api/tg-echo.js  (ESM) — TEMPORARY DEBUG
import { verifyTelegramInitData } from "./_tg.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const header = req.headers["x-telegram-init-data"] || "";
  let verified = null, error = null;

  try {
    verified = verifyTelegramInitData(header);
  } catch (e) {
    error = e?.message || String(e);
  }

  // only return small bits for privacy
  const snippet = header ? header.slice(0, 80) + "…" : "";

  res.json({
    has_header: !!header,
    header_snippet: snippet,            // first 80 chars so you know it's non-empty
    verified: !!verified,               // true/false
    user_id: verified?.user?.id || null,
    bot_token_present: !!process.env.BOT_TOKEN,
    env: process.env.VERCEL_ENV || "unknown",
    error
  });
}
