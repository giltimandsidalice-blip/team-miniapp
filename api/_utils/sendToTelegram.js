// api/_utils/sendToTelegram.js

async function sendOne({ botToken, chatId, text, parse_mode, disable_notification }) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode,
        disable_notification,
      }),
    });

    const bodyText = await res.text();
    let data = null;
    try { data = JSON.parse(bodyText); } catch { /* keep raw */ }

    if (!res.ok) {
      return {
        chatId,
        status: "fail",
        httpStatus: res.status,
        error: (data && (data.description || data.error)) || bodyText || "HTTP error",
      };
    }

    return {
      chatId,
      status: (data && data.ok) ? "ok" : "fail",
      httpStatus: res.status,
      error: data && !data.ok ? (data.description || "Unknown Telegram error") : null,
      message_id: data?.result?.message_id,
    };
  } catch (e) {
    return {
      chatId,
      status: "fail",
      httpStatus: null,
      error: e?.message || String(e),
    };
  }
}

/**
 * Send to many chats. Never throws; returns an array of result objects.
 */
export async function sendToMany({ botToken, chatIds, text, parse_mode = "HTML", disable_notification = false }) {
  const tasks = chatIds.map(chatId =>
    sendOne({ botToken, chatId, text, parse_mode, disable_notification })
  );
  return Promise.all(tasks);
}
