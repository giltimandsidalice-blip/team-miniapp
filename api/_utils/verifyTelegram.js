import crypto from "crypto";
 
/**
 * Verifies Telegram WebApp initData using the correct HMAC method.
 * @param {string} initDataRaw - The raw string from window.Telegram.WebApp.initData
 * @param {string} botToken - The Telegram bot token (must be the one that launched the WebApp)
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function verifyTelegramInitData(initDataRaw, botToken) {
  if (!initDataRaw || !botToken) {
    return { ok: false, error: "MISSING_INPUT" };
  }

  const params = new URLSearchParams(initDataRaw);
  const receivedHash = params.get("hash");
  if (!receivedHash) {
    return { ok: false, error: "NO_HASH" };
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const hashesMatch = crypto.timingSafeEqual(
    Buffer.from(receivedHash, "hex"),
    Buffer.from(expectedHash, "hex")
  );

  if (!hashesMatch) {
    return { ok: false, error: "BAD_HMAC" };
  }

  return { ok: true };
}
