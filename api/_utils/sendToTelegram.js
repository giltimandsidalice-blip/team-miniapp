const TOKEN = process.env.BOT_TOKEN;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function sendMessageOnce({ chat_id, text, parse_mode = "HTML", disable_notification = false }) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const body = {
    chat_id,
    text,
    parse_mode: parse_mode === "None" ? undefined : parse_mode,
    disable_notification
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));

  if (j?.ok) {
    return { ok: true, message_id: j.result.message_id };
  }

  // 429 handling (rate limit)
  if (!j?.ok && j?.error_code === 429) {
    const retryAfter = j.parameters?.retry_after ? Number(j.parameters.retry_after) * 1000 : 1000;
    return { ok: false, retry_after_ms: retryAfter, error_code: 429, error_reason: j.description || "Too Many Requests" };
  }

  return { ok: false, error_code: j?.error_code || r.status, error_reason: j?.description || "Telegram error" };
}

/**
 * Send with tiny backoff (best for small batches from the mini-app).
 * For very large batches, move this into a queue/worker later.
 */
export async function sendToMany({ chatIds, text, parse_mode, disable_notification }) {
  const results = [];
  for (const id of chatIds) {
    // 1 req/sec gentle pacing
    await sleep(350); // small delay to be nice; tweak if needed
    let attempt = 0;
    let last;

    while (attempt < 3) {
      attempt++;
      const res = await sendMessageOnce({ chat_id: id, text, parse_mode, disable_notification });
      last = res;

      if (res.ok) {
        results.push({ chat_id: id, status: "ok", message_id: res.message_id, attempts: attempt });
        break;
      }
      if (res.error_code === 429 && res.retry_after_ms) {
        await sleep(res.retry_after_ms);
        continue;
      } else {
        results.push({ chat_id: id, status: "failed", error_code: res.error_code, error_reason: res.error_reason, attempts: attempt });
        break;
      }
    }
  }
  return results;
}
