// api/_tg.js
import crypto from "node:crypto";

function getSecretKey() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is missing");
  return crypto.createHash("sha256").update(token).digest();
}

function parseInitData(initData = "") {
  const params = new URLSearchParams(initData);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return { params, obj };
}

export function verifyTelegramInitData(initData = "") {
  if (!initData || typeof initData !== "string") return null;

  const { params } = parseInitData(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  const kv = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    kv.push([k, v]);
  }
  kv.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = kv.map(([k, v]) => `${k}=${v}`).join("\n");

  const secret = getSecretKey();
  const hmac = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (hmac !== hash) return null;

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
