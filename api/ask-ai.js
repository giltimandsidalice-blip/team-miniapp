// api/ask-ai.js
import { createClient } from "@supabase/supabase-js";
import { llm, scrubPII } from "./_llm.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // ✅ move inside the handler to ensure runtime env availability
  const supabaseUrl = process.env.DATABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !supabaseUrl.startsWith("http")) {
    return res.status(500).json({ error: "Supabase client misconfigured (invalid DATABASE_URL)" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let payload = {};
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const chatId = payload?.chat_id || payload?.chatId;
  const prompt = (payload?.prompt || "").trim();

  if (!chatId || !prompt) {
    return res.status(400).json({ error: "Missing chat_id or prompt" });
  }

  try {
    const { data: messages, error } = await supabase
      .from("messages")
      .select("text")
      .eq("chat_id", chatId)
      .order("date", { ascending: true })
      .limit(400);

    if (error) throw new Error(error.message || "Failed to load messages");

    const chatContent = (messages || [])
      .map((m) => (m?.text || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();

    const systemPrompt =
      "You are an assistant for the Ad Group team. Answer questions using the supplied Telegram chat transcript.";

    const userPrompt = [
      chatContent
        ? `Chat transcript (scrubbed):\n${scrubPII(chatContent)}`
        : "Chat transcript is empty.",
      "",
      `Question: ${prompt}`,
      "",
      "Reply with a concise answer grounded in the conversation."
    ].join("\n");

    const response = await llm({
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.4,
      max_tokens: 320
    });

    return res.status(200).json({ text: response || "(no response)" });
  } catch (err) {
    console.error("Error in ask-ai:", err);
    return res.status(500).json({
      error: err?.message || "Unknown error",
      stage: "llm or supabase"
    });
  }
}
