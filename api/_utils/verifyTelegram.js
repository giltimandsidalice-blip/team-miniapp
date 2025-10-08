// api/_utils/verifyTelegram.js
import crypto from "crypto";

/**
 * Verifies Telegram WebApp initData (HMAC). Uses your BOT_TOKEN_AI.
 * Returns { ok: true, user } on success; { ok: false, error } on failure.
 */
export function verifyTelegramInitData(initData) {
  try {
    if (!initData) return { ok: false, error: "missing-init-data" };
    const botToken = process.env.BOT_TOKEN_AI;
    if (!botToken) return { ok: false, error: "missing-bot-token" };

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) return { ok: false, error: "missing-hash" };

    // Build data-check-string
    const entries = [];
    for (const [k, v] of urlParams.entries()) {
      if (k === "hash") continue;
      entries.push(`${k}=${v}`);
    }
    entries.sort();
    const dataCheckString = entries.join("\n");

    // Check hash
    const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    const calcHash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
    if (calcHash !== hash) return { ok: false, error: "bad-hmac" };

    // Parse user if present
    let user = null;
    const rawUser = urlParams.get("user");
    if (rawUser) {
      try { user = JSON.parse(rawUser); } catch {}
    }

    return { ok: true, user };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
