import crypto from "crypto";

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME; // optional (sanity check)
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.warn("[WARN] BOT_TOKEN is not set — API will not be able to send messages.");
}

function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const obj = {};
  for (const [k, v] of params) obj[k] = v;
  if (obj.user) {
    try { obj.user = JSON.parse(obj.user); } catch (_) {}
  }
  return obj;
}

export function verifyTelegramInitData(initData) {
  if (!initData) return { ok: false, error: "Missing init data" };
  const data = parseInitData(initData);

  // HMAC check per Telegram docs
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const checkString = Object.keys(data)
    .filter(k => k !== "hash")
    .sort()
    .map(k => `${k}=${typeof data[k] === "object" ? JSON.stringify(data[k]) : data[k]}`)
    .join("\n");

  const hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  if (hash !== data.hash) {
    return { ok: false, error: "Bad HMAC" };
  }

  // Optional: sanity checks
  if (!data.user?.id) return { ok: false, error: "No user in init data" };
  if (BOT_USERNAME && data?.receiver?.toLowerCase?.() !== BOT_USERNAME.toLowerCase()) {
    // receiver is the bot username Telegram includes in some clients; ignore if absent
  }

  return { ok: true, user: data.user };
}
