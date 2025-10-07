// api/_llm.js (ESM)
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export const scrubPII = (s = "") =>
  s.replace(/@[A-Za-z0-9_]+/g, "@user")
   .replace(/\+?\d[\d\s().-]{7,}\d/g, "##")
   .replace(/\b\d{9,}\b/g, "##");

export async function llm({ system, user, max_tokens = 380, temperature = 0.2, model }) {
  try {
    const res = await client.chat.completions.create({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: scrubPII(user) }
      ],
      temperature,
      max_tokens
    });
    return res.choices?.[0]?.message?.content?.trim() || "";
  } catch (e) {
    const msg = e?.message || String(e);
    const hintParts = [];
    if (!process.env.OPENAI_API_KEY) hintParts.push("Missing OPENAI_API_KEY");
    if (process.env.OPENAI_MODEL) hintParts.push(`OPENAI_MODEL=${process.env.OPENAI_MODEL}`);
    const hint = hintParts.join(" | ") || undefined;
    const err = new Error(`LLM request failed: ${msg}${hint ? ` (${hint})` : ""}`);
    err.status = 502;
    throw err;
  }
}

// convenience wrapper to mirror your older code
export async function chatComplete({ system, user, model, temperature }) {
  return llm({ system, user, model, temperature, max_tokens: 380 });
}
