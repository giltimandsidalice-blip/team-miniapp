// api/_utils/sendToTelegram.js

/**
 * Sends a text message to many chat IDs via Telegram Bot API.
 * Returns an array of per-chat results:
 *   { chat_id, status: "ok" } OR
 *   { chat_id, status: "error", http_status, description }
 */
export async function sendToMany({
  chatIds = [],
  text,
  parse_mode = "HTML",
  disable_notification = false,
  botToken,
}) {
  const results = [];
  const base = `https://api.telegram.org/bot${botToken}/sendMessage`;

  for (const chat_id of chatIds) {
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          text,
          parse_mode,
          disable_notification,
        }),
      });

      // Read raw text first so we can preserve Telegram's description on parse errors
      let raw = null;
      let j = null;
      try {
        raw = await r.text();
        j = JSON.parse(raw);
      } catch {
        /* keep raw */
      }

      if (!r.ok || !j?.ok) {
        // Telegram typical error: {"ok":false,"error_code":403,"description":"Forbidden: bot was blocked by the user"}
        const desc = j?.description || raw || `HTTP ${r.status}`;
        results.push({
          chat_id,
          status: "error",
          http_status: r.status,
          description: desc,
        });
      } else {
        results.push({ chat_id, status: "ok" });
      }
    } catch (err) {
      results.push({
        chat_id,
        status: "error",
        http_status: 0,
        description: err?.message || "Network error",
      });
    }

    // (Optional) small delay to be gentle with rate limits for big batches
    // await new Promise(r => setTimeout(r, 30));
  }

  // Do not throw; the route aggregates and returns sent/failed with details.
  return results;
}
