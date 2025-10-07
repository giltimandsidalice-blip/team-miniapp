// api/_tg.js
// Telegram WebApp initData verification (WebApp spec)
//
// WebApp secret:
//   secret = HMAC_SHA256( key = "WebAppData", message = BOT_TOKEN )
// Hash to compare:
//   hash = HMAC_SHA256( key = secret, message = data_check_string )
//
// data_check_string = join with "\n" the sorted (by key) "key=value" pairs
// for all initData fields EXCEPT "hash".

import crypto from "node:crypto";

// Build secret for WebApp verification (NOT plain SHA256)
function getSecretKey() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is missing");
  // WebApp-specific secret derivation:
  return crypto.createHmac("sha256", "WebAppData").update(token).digest();
}

function parseInitData(initData = "") {
  const params = new URLSearchParams(initData);
  return params;
}

export function verifyTelegramInitData(initData = "") {
  if (!initData || typeof initData !== "string") return null;

  const params = parseInitData(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return null;

  // Build data_check_string
  const kv = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    kv.push([k, v]);
  }
  kv.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = kv.map(([k, v]) => `${k}=${v}`).join("\n");

  // Compute expected hash with WebApp secret
  const secret = getSecretKey();
  const expectedHash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  if (expectedHash !== receivedHash) return null;

  // Best-effort decode user (may be absent for group launches)
  let user = null;
  const rawUser = params.get("user");
  if (rawUser) { try { user = JSON.parse(rawUser); } catch {} }

  return {
    ok: true,
    user,
    chat_type: params.get("chat_type") || null,
    chat_instance: params.get("chat_instance") || null,
    query_id: params.get("query_id") || null
  };
}
