// api/_utils/verifyTelegram.js
// Verifies Telegram WebApp initData using the _launching_ bot's token.
// IMPORTANT: the token must be in process.env.BOT_TOKEN.
// (We also fall back to BOT_TOKEN_AI just in case you still have it set.)

import crypto from "crypto";

/**
 * Parse the raw initData string (querystring format) into an object.
 */
function parseInitData(raw = "") {
  const out = {};
  new URLSearchParams(raw).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/**
 * Validate Telegram WebApp init data HMAC.
 * Spec summary:
 *  - Build data_check_string by joining "<key>=<value>" lines
 *    for all keys except "hash", sorted lexicographically by key.
 *  - secret_key = SHA256(bot_token)  (binary)
 *  - expected_hash = HMAC_SHA256(secret_key, data_check_string)
 *  - Compare expected_hash (hex) with provided "hash".
 */
export function verifyTelegramInitData(initDataRaw = "") {
  try {
    const botToken =
      process.env.BOT_TOKEN || process.env.BOT_TOKEN_AI || "";

    if (!botToken) {
      return { ok: false, error: "BOT_TOKEN_NOT_CONFIGURED" };
    }

    if (!initDataRaw || typeof initDataRaw !== "string") {
      return { ok: false, error: "NO_INIT_DATA" };
    }

    const data = parseInitData(initDataRaw);
    const receivedHash = data.hash;
    if (!receivedHash) {
      return { ok: false, error: "MISSING_HASH" };
    }

    // Build data_check_string
    const pairs = Object.keys(data)
      .filter((k) => k !== "hash")
      .sort()
      .map((k) => `${k}=${data[k]}`);
    const dataCheckString = pairs.join("\n");

    // secret_key = SHA256(bot_token)
    const secretKey = crypto
      .createHash("sha256")
      .update(botToken)
      .digest();

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

    if (!ok) {
      return { ok: false, error: "BAD_HMAC" };
    }

    // Optionally expose parsed user info back to the caller
    let user = null;
    if (data.user) {
      try {
        user = JSON.parse(data.user);
      } catch {}
    }

    return { ok: true, user, raw: data };
  } catch (e) {
    return { ok: false, error: e?.message || "VERIFY_ERROR" };
  }
}
