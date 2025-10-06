// /api/diag.js  (remove later)
export default async function handler(req, res) {
  res.json({
    openai_key_present: !!process.env.OPENAI_API_KEY,
    openai_model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    vercel_env: process.env.VERCEL_ENV || "unknown"
  });
}
