// api/_tg.js
// Verifies Telegram WebApp initData per Telegram docs.
// Requires BOT_TOKEN set in Vercel env.

import crypto from "node:crypto";

/** Build secret key: SHA256 of the bot token */
function getSecretKey() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("BOT_TOKEN is missing");
  }
  return crypto.createHash("sha256").update(token).digest();
}

/** Parse initData (querystring) into a plain object */
function parseInitData(initData = "") {
  const params = new URLSearchParams(initData);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return { params, obj };
}

/** Verify HMAC per Telegram spec and return decoded fields (or null if invalid) */
export function verifyTelegramInitData(initData = "") {
  if (!initData || typeof initData !== "string") return null;

  const { params } = parseInitData(initData);

  const hash = params.get("hash");
  if (!hash) return null;

  // Build data-check string: all params except 'hash', sorted by key, "key=value" joined by '\n'
  const kv = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    kv.push([k, v]);
  }
  kv.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = kv.map(([k, v]) => `${k}=${v}`).join("\n");

  // HMAC-SHA256(dataCheckString, secret=SHA256(bot_token))
  const secret = getSecretKey();
  const hmac = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  if (hmac !== hash) return null;

  // (Optional) freshness check (auth_date is seconds)
  const authDate = Number(params.get("auth_date")) || 0;
  if (authDate && Math.abs(Date.now() / 1000 - authDate) > 60 * 60 * 24 * 7) {
    // older than 7 days — still accept for now, or return null to enforce freshness
    // return null;
  }

  // Decode user JSON if present
  let user = null;
  const rawUser = params.get("user");
  if (rawUser) {
    try { user = JSON.parse(rawUser); } catch {}
  }

  return {
    ok: true,
    user,
    chat_type: params.get("chat_type") || null,
    chat_instance: params.get("chat_instance") || null,
    query_id: params.get("query_id") || null
  };
}
