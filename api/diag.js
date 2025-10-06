// /api/diag.js
export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.json({
    openai_key_present: !!process.env.OPENAI_API_KEY,
    openai_model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    vercel_env: process.env.VERCEL_ENV || "unknown"
  });
}
