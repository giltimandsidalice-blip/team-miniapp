// api/_utils/sendToTelegram.js

/**
 * Send a single message via Telegram sendMessage API.
 * Returns { status: "ok", chat_id } on success
 * or { status: "error", chat_id, code, description, http_status } on failure.
 */
async function sendOne({ botToken, chat_id, text, parse_mode = "HTML", disable_notification = false }) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const body = {
    chat_id,
    text,
    parse_mode,
    disable_notification,
    // You can add "link_preview_options" or "disable_web_page_preview" if you need later
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Parse response safely
    const data = await r.json().catch(async () => {
      const txt = await r.text().catch(() => "");
      return { ok: false, non_json: true, raw: txt };
    });

    if (!r.ok || !data?.ok) {
      // Telegram “ok:false” or HTTP error
      return {
        status: "error",
        chat_id,
        http_status: r.status,
        code: data?.error_code || null,
        description: data?.description || data?.raw || `HTTP ${r.status}`,
      };
    }

    return { status: "ok", chat_id };
  } catch (e) {
    return {
      status: "error",
      chat_id,
      http_status: 0,
      code: "FETCH_FAILED",
      description: e?.message || "Network error",
    };
  }
}

/**
 * Send to many chat IDs in series (safe for small/medium batches).
 * Returns an array like:
 * [{ status:"ok", chat_id }, { status:"error", chat_id, description, ... }, ...]
 */
export async function sendToMany({ chatIds, text, parse_mode, disable_notification, botToken }) {
  const out = [];
  for (const id of chatIds) {
    const r = await sendOne({
      botToken,
      chat_id: id,
      text,
      parse_mode,
      disable_notification,
    });
    out.push(r);
  }
  return out;
}
