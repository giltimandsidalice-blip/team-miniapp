// api/company-blurb.js (ESM, robust)
// Tries v_candidate_blurbs if present; otherwise falls back to messages → heuristic/LLM blurb.
// Requires: _db.js (q), _tg.js (verifyTelegramInitData), _llm.js (llm)

import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";
import { llm } from "./_llm.js";

const SKIP_AUTH = false; // set true only for brief local tests
const DAYS_WINDOW = Number(process.env.BLURB_WINDOW_DAYS || 120);
const TEAM_USERS = (process.env.TEAM_USERS || "@Web3Reachout,@Shefer712,@travalss,@phoebemangoba")
  .split(",")
  .map(s => s.trim().replace(/^@/, "").toLowerCase())
  .filter(Boolean);

function norm(u = "") { return u.replace(/^@/, "").toLowerCase(); }
const isTeamUser = (u) => !!u && TEAM_USERS.includes(norm(u));

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // 0) Auth
  try {
    if (!SKIP_AUTH) {
      const initData = req.headers["x-telegram-init-data"] || req.query.init_data || req.body?.init_data || "";
      const ok = verifyTelegramInitData(initData);
      if (!ok) return res.status(401).json({ error: "unauthorized", stage: "auth" });
    }
  } catch (e) {
    return res.status(401).json({ error: `auth_failed: ${e?.message || e}`, stage: "auth" });
  }

  // 1) Inputs
  const chatId = req.query.chat_id;
  if (!chatId) return res.status(400).json({ error: "chat_id required", stage: "input" });

  // 2) Try the view (if it exists)
  try {
    const { rows: check } = await q(
      `SELECT 1
         FROM pg_catalog.pg_views
        WHERE viewname = 'v_candidate_blurbs'
        LIMIT 1`
    );
    if (check?.length) {
      const { rows } = await q(
        `select chat_id, id, date, sample as blurb, score
           from v_candidate_blurbs
          where chat_id = $1
          order by score desc, date desc
          limit 1`,
        [chatId]
      );
      if (rows?.length && rows[0]?.blurb) {
        return res.status(200).json({
          blurb: rows[0].blurb,
          source: "view",
          score: rows[0].score ?? null,
          msg_id: rows[0].id ?? null
        });
      }
      // fall through to auto if view has nothing for this chat
    }
  } catch (e) {
    // View missing or query failed — fall back to auto
    // (don’t error out; keep going)
  }

  // 3) Fallback: pull recent messages (include client + team; we’ll filter lightly)
  let msgs = [];
  try {
    const { rows } = await q(
      `
      SELECT m.text, m.date, u.username
      FROM messages m
      LEFT JOIN tg_users u ON u.id = m.sender_id
      WHERE m.chat_id = $1
        AND m.text IS NOT NULL
        AND m.is_service = false
        AND m.date > now() - interval '${DAYS_WINDOW} days'
      ORDER BY m.date DESC
      LIMIT 400
      `,
      [chatId]
    );
    msgs = rows || [];
  } catch (e) {
    return res.status(500).json({ error: `db_failed: ${e?.message || e}`, stage: "db_msgs" });
  }

  if (!msgs.length) {
    return res.status(200).json({ blurb: null, note: "no recent messages", source: "none" });
  }

  // 4) Heuristic candidate extraction
  const cleaned = msgs
    .map(r => ({
      text: (r.text || "").replace(/\s+/g, " ").trim(),
      me: isTeamUser(r.username)
    }))
    .filter(r => r.text && r.text.length >= 8);

  // Prefer non-team descriptions first
  const nonTeam = cleaned.filter(m => !m.me).map(m => m.text);
  const team = cleaned.filter(m => m.me).map(m => m.text);
  const corpus = (nonTeam.length ? nonTeam : cleaned.map(m => m.text)).join("\n");

  // Quick heuristics: look for “we are/we do/platform/protocol/mission/launch” style lines
  const lines = corpus.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const scored = lines.map(s => ({
    s,
    score:
      (/\b(we\s+are|we\s+do|we\s+build|our\s+(platform|protocol|product)|mission|vision|launch|introduc(e|ing))\b/i.test(s) ? 2 : 0) +
      (/\b(platform|protocol|marketplace|app|tool|infrastructure|sdk|api)\b/i.test(s) ? 1 : 0) +
      (/\b(for|to)\b.+\b(users?|creators?|brands?|projects?|web3|crypto|defi|nft|ai)\b/i.test(s) ? 1 : 0) +
      (s.length >= 40 && s.length <= 220 ? 1 : 0)
  }));
  scored.sort((a,b)=>b.score - a.score);

  let heuristic = (scored[0]?.s || lines[0] || "").slice(0, 280);
  // Make it one or two sentences max
  if (heuristic.split(/[.!?]/).length > 2) {
    const firstTwo = heuristic.match(/(.+?[.!?])(.+?[.!?])?/);
    heuristic = (firstTwo ? (firstTwo[1] + (firstTwo[2] || "")) : heuristic).trim();
  }

  // 5) Optional LLM polish
  if (process.env.OPENAI_API_KEY && heuristic) {
    try {
      const prompt = `From the chat snippets below, extract a crisp 1–2 sentence "company blurb" describing the project.
- English only.
- No PII or usernames.
- No promises or hype; be factual.
- Keep it under 50 words.
- If unclear, write the best neutral description you can.

Snippets (latest first):
${corpus.slice(0, 6000)}`;

      const text = await llm({
        system: "You write concise, neutral product blurbs. English only.",
        user: prompt,
        model: "gpt-4o-mini",
        max_tokens: 120,
        temperature: 0.2
      });

      const polished = (text || "").trim().replace(/\s+/g, " ");
      if (polished && polished.length >= 20) {
        return res.status(200).json({
          blurb: polished.slice(0, 400),
          source: "llm",
          fallback: heuristic.slice(0, 300)
        });
      }
    } catch (e) {
      // ignore and fall back to heuristic
    }
  }

  // 6) Heuristic result (no OpenAI or LLM failed)
  if (heuristic && heuristic.length >= 20) {
    return res.status(200).json({ blurb: heuristic, source: "heuristic" });
  }

  // 7) Nothing decent found
  return res.status(200).json({ blurb: null, note: "no strong candidates found", source: "none" });
}
