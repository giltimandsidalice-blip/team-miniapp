// api/debug-verify.js
import { verifyTelegramInitData } from "./_utils/verifyTelegram.js";

function tokenBotId(tok = "") {
  // token format: <bot_id>:<secret>
  return tok && tok.split(":")[0];
}

export default async function handler(req, res) {
  const initData = req.headers["x-telegram-init-data"] || "";
  const result = verifyTelegramInitData(initData);

  // Bot id extracted from token on server
  const token = process.env.BOT_TOKEN || "";
  const expectedBotId = tokenBotId(token) || null;

  // Bot id that actually opened the Mini App (comes in init data)
  let receivedBotId = null;
  try {
    const raw = new URLSearchParams(initData);
    receivedBotId = raw.get("bot_id");
  } catch {}

  return res.status(result.ok ? 200 : 401).json({
    ok: result.ok,
    error: result.ok ? null : result.error,
    // helps confirm which bot the server verifies with vs which bot launched the app
    expectedBotId,        // from BOT_TOKEN on server
    receivedBotId,        // from Telegram init data
    sawInitData: !!initData,
    initDataLength: initData?.length || 0,
  });
}
