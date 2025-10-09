// api/_utils/verifyTelegram.js
// Verifies Telegram WebApp initData using the bot token that LAUNCHED the Mini App.
// IMPORTANT: the token MUST be in process.env.BOT_TOKEN (no fallbacks).

import crypto from "crypto";

function parseInitData(raw = "") {
  const out = {};
  new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
  return out;
}

export function verifyTelegramInitData(initDataRaw = "") {
  try {
    const botToken = process.env.BOT_TOKEN || "";
    if (!botToken) return { ok: false, error: "BOT_TOKEN_NOT_CONFIGURED" };

    if (!initDataRaw || typeof initDataRaw !== "string") {
      return { ok: false, error: "NO_INIT_DATA" };
    }

    const data = parseInitData(initDataRaw);
    const receivedHash = data.hash;
    if (!receivedHash) return { ok: false, error: "MISSING_HASH" };

    // Build data_check_string
    const dataCheckString = Object.keys(data)
      .filter(k => k !== "hash")
      .sort()
      .map(k => `${k}=${data[k]}`)
      .join("\n");

    // secret_key = SHA256(bot_token)
    const secretKey = crypto.createHash("sha256").update(botToken).digest();

    // expected hash = HMAC_SHA256(secret_key, data_check_string)
    const expectedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const ok =
      expectedHash.length === receivedHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(expectedHash, "hex"),
        Buffer.from(receivedHash, "hex")
      );

    if (!ok) return { ok: false, error: "BAD_HMAC" };

    let user = null;
    if (data.user) { try { user = JSON.parse(data.user); } catch {} }
    return { ok: true, user, raw: data };
  } catch (e) {
    return { ok: false, error: e?.message || "VERIFY_ERROR" };
  }
}
