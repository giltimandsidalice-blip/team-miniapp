// api/debug-verify.js
import { verifyTelegramInitData } from "./_utils/verifyTelegram.js";

export default async function handler(req, res) {
  const initData = req.headers["x-telegram-init-data"] || "";
  const result = verifyTelegramInitData(initData);
  return res.status(result.ok ? 200 : 401).json({
    ok: result.ok,
    error: result.ok ? null : result.error,
    token_in_use: process.env.BOT_TOKEN ? "BOT_TOKEN:set" : "BOT_TOKEN:missing",
  });
}
