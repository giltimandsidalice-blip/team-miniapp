// api/_utils/verifyTelegram.js
import crypto from "crypto";

/**
 * Verify Telegram WebApp initData per:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 * Returns { ok: true, user, raw } or { ok: false, error }
 */
export function verifyTelegramInitData(initData) {
  try {
    if (!initData || typeof initData !== "string") {
      return { ok: false, error: "MISSING_INIT_DATA" };
    }

    const token = process.env.BOT_TOKEN_AI; // <— IMPORTANT: your env name
    if (!token) {
      return { ok: false, error: "SERVER_MISCONFIGURED_NO_BOT_TOKEN" };
    }

    // Parse initData (URL-encoded querystring)
    const url = new URLSearchParams(initData);
    const authDate = url.get("auth_date");
    const hash = url.get("hash");
    if (!hash) return { ok: false, error: "MISSING_HASH" };

    // Build data-check-string: all entries except 'hash', sorted by key
    const pairs = [];
    url.forEach((v, k) => { if (k !== "hash") pairs.push(`${k}=${v}`); });
    pairs.sort(); // lexicographic by key
    const dataCheckString = pairs.join("\n");

    // Secret key = HMAC-SHA256 of bot token with key "WebAppData"
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(token)
      .digest();

    // Our signature
    const ourHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (ourHash !== hash) {
      return { ok: false, error: "BAD_HMAC" };
    }

    // Optional: reject if too old (e.g., > 24h)
    if (authDate && Number.isFinite(+authDate)) {
      const ageSec = Math.floor(Date.now() / 1000) - Number(authDate);
      if (ageSec > 60 * 60 * 24) {
        return { ok: false, error: "AUTH_DATE_EXPIRED" };
      }
    }

    // Extract user (if provided)
    let user = null;
    const userJson = url.get("user");
    if (userJson) {
      try { user = JSON.parse(userJson); } catch {}
    }

    return { ok: true, user, raw: initData };
  } catch (e) {
    return { ok: false, error: e?.message || "VERIFY_EXCEPTION" };
  }
}
