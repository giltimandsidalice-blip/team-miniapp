// api/_utils/verifyTelegram.js
import crypto from "crypto";

/** Keep raw values from initData (do not re-encode) */
function parseInitData(raw = "") {
  const out = {};
  new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
  return out;
}

function hmacOK(token, dataCheckString, receivedHash) {
  const secretKey = crypto.createHash("sha256").update(token).digest();
  const expected = crypto.createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return (
    expected.length === receivedHash.length &&
    crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(receivedHash, "hex"))
  );
}

/**
 * Verify against ALL configured tokens (BOT_TOKEN, BOT_TOKEN_AI).
 * Returns which token matched so the caller can send with the same bot.
 */
export function verifyTelegramInitData(initDataRaw = "") {
  try {
    const candidates = [
      { name: "BOT_TOKEN",     token: process.env.BOT_TOKEN     || "" },
      { name: "BOT_TOKEN_AI",  token: process.env.BOT_TOKEN_AI  || "" },
    ].filter(t => t.token);

    if (!candidates.length) {
      return { ok: false, error: "BOT_TOKEN_NOT_CONFIGURED" };
    }
    if (!initDataRaw || typeof initDataRaw !== "string") {
      return { ok: false, error: "NO_INIT_DATA" };
    }

    const data = parseInitData(initDataRaw);
    const receivedHash = data.hash;
    if (!receivedHash) return { ok: false, error: "MISSING_HASH" };

    // Build data_check_string using raw (already-decoded) values
    const dataCheckString = Object.keys(data)
      .filter(k => k !== "hash")
      .sort()
      .map(k => `${k}=${data[k]}`)
      .join("\n");

    // Try each token; succeed if any matches
    for (const c of candidates) {
      if (hmacOK(c.token, dataCheckString, receivedHash)) {
        const matchedBotId = c.token.split(":")[0] || null;
        let user = null;
        if (data.user) { try { user = JSON.parse(data.user); } catch {} }
        return {
          ok: true,
          user,
          raw: data,
          matchedEnv: c.name,          // "BOT_TOKEN" or "BOT_TOKEN_AI"
          matchedBotId,                // numeric id as string
        };
      }
    }

    // none matched
    return {
      ok: false,
      error: "BAD_HMAC",
      expectedBotIds: candidates.map(c => c.token.split(":")[0]).filter(Boolean),
      sawInitData: true,
      initDataLength: initDataRaw.length,
    };
  } catch (e) {
    return { ok: false, error: e?.message || "VERIFY_ERROR" };
  }
}
