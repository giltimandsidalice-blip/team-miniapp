// api/_utils/verifyTelegram.js
import crypto from "crypto";

/**
 * Validate Telegram WebApp initData WITHOUT decoding values.
 * We must hash the exact raw querystring pairs (except 'hash'),
 * sorted by key and joined with '\n'.
 */
export function verifyTelegramInitData(initData) {
  try {
    if (!initData || typeof initData !== "string") {
      return { ok: false, error: "MISSING_INIT_DATA" };
    }

    const token = process.env.BOT_TOKEN_AI; // your env name
    if (!token) {
      return { ok: false, error: "SERVER_MISCONFIGURED_NO_BOT_TOKEN" };
    }

    // Split raw pairs, keep them as-is (no decode!)
    const rawPairs = initData.split("&").filter(Boolean);

    // Extract hash and keep other pairs
    let providedHash = null;
    const keptPairs = [];
    for (const p of rawPairs) {
      // Only split on the first '=' to preserve any '=' inside JSON
      const eq = p.indexOf("=");
      const k = eq >= 0 ? p.slice(0, eq) : p;
      if (k === "hash") {
        providedHash = eq >= 0 ? p.slice(eq + 1) : "";
      } else {
        keptPairs.push([k, eq >= 0 ? p.slice(eq + 1) : ""]);
      }
    }
    if (!providedHash) return { ok: false, error: "MISSING_HASH" };

    // Sort by key and build data-check-string using the *raw* values
    keptPairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const dataCheckString = keptPairs.map(([k, v]) => `${k}=${v}`).join("\n");

    // Secret key = HMAC-SHA256(token) with key "WebAppData"
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(token)
      .digest();

    const calcHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (calcHash !== providedHash) {
      return { ok: false, error: "BAD_HMAC" };
    }

    // Optional freshness check
    const authDatePair = keptPairs.find(([k]) => k === "auth_date");
    if (authDatePair) {
      const authDate = Number(authDatePair[1]);
      if (Number.isFinite(authDate)) {
        const ageSec = Math.floor(Date.now() / 1000) - authDate;
        if (ageSec > 60 * 60 * 24) return { ok: false, error: "AUTH_DATE_EXPIRED" };
      }
    }

    // Parse user only for convenience (safe to decode AFTER verification)
    let user = null;
    const userPair = keptPairs.find(([k]) => k === "user");
    if (userPair) {
      try {
        user = JSON.parse(decodeURIComponent(userPair[1]));
      } catch {}
    }

    return { ok: true, user, raw: initData };
  } catch (e) {
    return { ok: false, error: e?.message || "VERIFY_EXCEPTION" };
  }
}
