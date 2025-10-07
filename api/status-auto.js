// api/status-auto.js — STRICT evidence-gated status detection (EN/RU)
// Requires: _db.js (ESM), _tg.js, _llm.js present in /api
// Env (optional):
//   STATUS_WINDOW_DAYS=60        // how far back to look
//   STATUS_LOG=false             // true to include debug evidence in response
//   SKIP_AUTH=false              // set true only while testing (Telegram auth off)

import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";
import { llm } from "./_llm.js";

const LABELS = [
  "Talking stage",
  "Awaiting SoW",
  "SoW signed",
  "Awaiting payment",
  "Paid",
  "Preparing campaign",
  "Campaign live",
  "Awaiting report",
  "Campaign finished",
];

const DAYS_WINDOW = Number(process.env.STATUS_WINDOW_DAYS || 60);
const INCLUDE_DEBUG = String(process.env.STATUS_LOG || "false").toLowerCase() === "true";
const SKIP_AUTH = String(process.env.SKIP_AUTH || "false").toLowerCase() === "true";

// -------------------- Pattern Sets (EN + RU) --------------------

const RX = {
  // SoW signed
  sowSigned: [
    /\b(sow|scope of work|contract|agreement)\b.*\b(counter-)?signed|executed|fully\s+signed/iu,
    /\bподписан(о|а)?\b.*\b(dogovor|контракт|соглашение|тз|sow)\b/iu, // "подписан договор/контракт/..." (rough)
    /\bсоглашение\b.*\bподписан/iu,
  ],

  // Awaiting SoW (request to sign)
  awaitingSoW: [
    /(please|kindly)?\s*(sign|countersign|execute)\s*(the\s*)?(sow|contract|agreement)/iu,
    /\bawaiting\b.*\b(sow|contract|agreement)\b/iu,
    /\bнужно\b.*\bподписать\b.*\b(sow|договор|контракт|соглашение)\b/iu,
    /\bжд(ём|ем)\b.*\bподписан(ия|ие)\b.*\b(sow|договора|контракта|соглашения)\b/iu,
  ],

  // Payment contexts that should NOT count
  paidFalseContext: [
    /\bpaid\s+(plan|tier|version|subscription|feature|media|promotion|ads?|traffic|users?)\b/iu,
    /\bплатн(ая|ые|ый)\s+(версия|подписка|реклама|продвижение|медиа|тариф)\b/iu,
  ],

  // Awaiting payment (invoice sent / request to pay)
  awaitingPayment: [
    /\b(invoice|payment|wire|bank transfer|remittance|tx|transaction)\b.*\b(sent|issued|shared|awaiting|pending|due|pay|settle|payment details)\b/iu,
    /\bplease\s+(pay|wire|transfer|settle|remit)\b/iu,
    /\bсчет\b.*\b(выслан|отправил|отправили|выслали|выставлен|выставили)\b/iu,
    /\bжд(ём|ем)\b.*\b(оплаты|платежа)\b/iu,
    /\bпросим\b.*\b(оплатить|перевести)\b/iu,
    /\bреквизиты\b.*\b(оплаты|для оплаты|для перевода)\b/iu,
  ],

  // Payment confirmed (very strict)
  paidStrong: [
    /\b(payment|wire|transfer|remittance|funds|tx|transaction|usdt|usdc|crypto)\b.*\b(received|confirmed|credited|landed|settled|cleared)\b/iu,
    /\b(invoice)\b.*\b(paid|settled)\b/iu,
    /\bpayment\b.*\bconfirmed\b/iu,
    /\bоплата\b.*\b(получен[аы]?|поступил[аи]?|подтвержден[аы]?|зачислен[аы]?|проведена)\b/iu,
    /\bсчет\b.*\b(оплачен|закрыт)\b/iu,
    /\bденьги\b.*\b(пришл[и]?|поступил[аи]?)\b/iu,
    /\bплатеж\b.*\b(прошел|проведен)\b/iu,
    /\btx\b.*\bconfirmed\b/iu,
  ],

  // Negations around payment (block "Paid" if these appear after)
  paymentNegation: [
    /\b(not|hasn'?t|have not|haven't|no)\s+(yet\s+)?(paid|received|landed|credited|confirmed|arrived)\b/iu,
    /\bоплата\b.*\b(не\s+получен[аы]?|еще\s+нет|не\s+поступил[аи]?|не\s+подтвержден[аы]?)\b/iu,
    /\bждем\b.*\bоплат[уы]\b/iu,
  ],

  // Campaign prep / live / report / finished
  preparing: [
    /(kol|influencer|creator|brief|creative|asset|shortlist|whitelist|allowlist).*(list|shortlist|select|choose|review)/iu,
    /\bprep(ar(e|ing))?\s+campaign\b/iu,
    /\bбриф\b|\bкреатив(ы)?\b|\bподбор\b.*(кол|инфлуенсеров|создателей)\b/iu,
  ],
  live: [
    /\b(kick(\s*)off|kicked\s*off|go\s*live|launch(ed|ing)?|campaign\s+live|live\s+now|started\s+campaign)\b/iu,
    /\bзапуск\b|\bвышли\s+в\s+лайв\b|\bкампания\s+запущен[аы]?\b/iu,
  ],
  awaitingReport: [
    /\b(report|results)\b.*\b(due|pending|awaiting|request|requested)\b/iu,
    /\bжд(ём|ем)\b.*\bотчет(а|)\b/iu,
  ],
  finished: [
    /\b(final\s+report|post-?mortem|wrap\s*up|delivered\s+report|campaign\s+(closed|finished|ended|complete(d)?))\b/iu,
    /\bфинальн(ый|ый\s+отчет|ый\s+отчёт)\b|\bкампания\b.*\b(закончена|закрыта|завершена)\b/iu,
  ],

  // Prepayment allowance
  prepayment: [/\bpre-?payment|advance\s+payment|deposit\b/iu, /\bпредоплат(а|у|ой)\b/iu],
};

// Utility to test if any regex in a list matches
const anyMatch = (patterns, s) => patterns.some((re) => re.test(s));

// -------------------- Evidence Extraction & Scoring --------------------

function analyzeMessages(rows) {
  // rows: [{text, date}]
  const joined = rows.map((r) => r.text || "").join("\n");

  const evidence = {
    sowSigned: false,
    awaitingSoW: false,
    awaitingPayment: false,
    paidStrong: false,
    paymentNegation: false,
    prepayment: false,
    preparing: false,
    live: false,
    awaitingReport: false,
    finished: false,

    // recency tracking
    ts: {
      sowSigned: null,
      awaitingSoW: null,
      awaitingPayment: null,
      paidStrong: null,
      paymentNegation: null,
      preparing: null,
      live: null,
      awaitingReport: null,
      finished: null,
    },
  };

  // evaluate per message to track recency
  for (const r of rows) {
    const t = (r.text || "");
    const d = new Date(r.date).getTime();

    const hit = (key, cond) => {
      if (cond) {
        evidence[key] = true;
        if (!evidence.ts[key] || d > evidence.ts[key]) evidence.ts[key] = d;
      }
    };

    hit("sowSigned", anyMatch(RX.sowSigned, t));
    hit("awaitingSoW", anyMatch(RX.awaitingSoW, t));
    hit("awaitingPayment", anyMatch(RX.awaitingPayment, t) && !anyMatch(RX.paidFalseContext, t));
    hit("paidStrong", anyMatch(RX.paidStrong, t) && !anyMatch(RX.paidFalseContext, t));
    hit("paymentNegation", anyMatch(RX.paymentNegation, t));

    hit("preparing", anyMatch(RX.preparing, t));
    hit("live", anyMatch(RX.live, t));
    hit("awaitingReport", anyMatch(RX.awaitingReport, t));
    hit("finished", anyMatch(RX.finished, t));

    // prepayment flag
    if (anyMatch(RX.prepayment, t)) {
      evidence.prepayment = true;
    }
  }

  return evidence;
}

function pickStatus(e) {
  // Hard gates for money:
  // - "Paid" only if strong confirm AND no *newer* negation afterwards.
  // - "Awaiting payment" only if invoice/request evidence, not invalidated by later "Paid".
  // - Payment labels require SoW signed OR explicit prepayment allowed.
  const since = (ts) => (ts ? new Date(ts).toISOString() : null);

  const paidAllowed =
    e.paidStrong &&
    !(e.paymentNegation && e.ts.paymentNegation && e.ts.paidStrong && e.ts.paymentNegation > e.ts.paidStrong);

  const awaitingPayAllowed =
    e.awaitingPayment &&
    !(e.paidStrong && e.ts.paidStrong && e.ts.awaitingPayment && e.ts.paidStrong > e.ts.awaitingPayment);

  const sowGate = e.sowSigned || e.prepayment;

  // Campaign lifecycle
  if (e.finished) return { status: "Campaign finished", reason: "finished", ts: since(e.ts.finished) };
  if (e.awaitingReport) return { status: "Awaiting report", reason: "awaitingReport", ts: since(e.ts.awaitingReport) };
  if (e.live) return { status: "Campaign live", reason: "live", ts: since(e.ts.live) };
  if (e.preparing) return { status: "Preparing campaign", reason: "preparing", ts: since(e.ts.preparing) };

  // Contract/payment ladder
  if (sowGate && awaitingPayAllowed) {
    return { status: "Awaiting payment", reason: "awaitingPayment", ts: since(e.ts.awaitingPayment) };
  }
  if (sowGate && paidAllowed) {
    return { status: "Paid", reason: "paidStrong", ts: since(e.ts.paidStrong) };
  }
  if (e.sowSigned) return { status: "SoW signed", reason: "sowSigned", ts: since(e.ts.sowSigned) };
  if (e.awaitingSoW) return { status: "Awaiting SoW", reason: "awaitingSoW", ts: since(e.ts.awaitingSoW) };

  return { status: "Talking stage", reason: "default" };
}

// -------------------- HTTP Handler --------------------

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // Telegram auth (keep strict in production)
  try {
    if (!SKIP_AUTH) {
      const initData =
        req.headers["x-telegram-init-data"] ||
        req.query.init_data ||
        req.body?.init_data ||
        "";
      const ok = verifyTelegramInitData(initData);
      if (!ok) return res.status(401).json({ error: "unauthorized", stage: "auth" });
    }
  } catch (e) {
    return res.status(401).json({ error: `auth_failed: ${e?.message || e}`, stage: "auth" });
  }

  // Inputs
  const chatId = req.query.chat_id;
  const limit = Math.min(parseInt(req.query.limit || "400", 10), 800);
  if (!chatId) return res.status(400).json({ error: "chat_id required" });

  try {
    // Pull only recent, non-team, non-empty text from your view
    const { rows } = await q(
      `
      SELECT text, date
      FROM v_messages_non_team
      WHERE chat_id = $1
        AND text IS NOT NULL
        AND date > now() - interval '${DAYS_WINDOW} days'
      ORDER BY date DESC
      LIMIT $2
      `,
      [chatId, limit]
    );

    if (!rows.length) {
      return res.status(200).json({ status: "Talking stage", samples_used: 0, window_days: DAYS_WINDOW });
    }

    const ev = analyzeMessages(rows);
    let picked = pickStatus(ev);

    // Optional LLM refinement — *only* within allowed ladder and never overriding payment gates
    // (kept very conservative; you can disable by removing this block)
    if (process.env.OPENAI_API_KEY && rows.length >= 10) {
      try {
        const snippets = rows
          .slice(0, 120)
          .map((r) => (r.text || "").replace(/\s+/g, " ").slice(0, 300))
          .join("\n");

        const prompt = `Choose ONE label ONLY from: ${LABELS.join(
          ", "
        )}. Output EXACTLY the label.\n\nRules:\n- "Paid" requires explicit confirmation (e.g., payment received/credited/settled, "invoice paid"). Mentions like "paid media/plan/promotion" DO NOT count.\n- "Awaiting payment" requires invoice/payment request AND no later confirmation of funds received.\n- Do not choose payment labels unless SoW is signed OR explicit prepayment (deposit) is stated.\n- Prefer recency (last ${DAYS_WINDOW} days). English output only.\n\nSnippets (latest first):\n${snippets}`;

        const ans = (await llm({ system: "English only. Return just the label.", user: prompt, model: "gpt-4o-mini", max_tokens: 8, temperature: 0 })).trim();

        if (LABELS.includes(ans)) {
          // Enforce payment gates again
          if (ans === "Paid") {
            const paidAllowed =
              ev.paidStrong &&
              !(ev.paymentNegation && ev.ts.paymentNegation && ev.ts.paidStrong && ev.ts.paymentNegation > ev.ts.paidStrong);
            if (paidAllowed) picked = { status: "Paid", reason: "llm+gate" };
          } else if (ans === "Awaiting payment") {
            const awaitingPayAllowed =
              ev.awaitingPayment &&
              !(ev.paidStrong && ev.ts.paidStrong && ev.ts.awaitingPayment && ev.ts.paidStrong > ev.ts.awaitingPayment);
            const sowGate = ev.sowSigned || ev.prepayment;
            if (sowGate && awaitingPayAllowed) picked = { status: "Awaiting payment", reason: "llm+gate" };
          } else {
            // Non-money labels can be trusted directly
            picked = { status: ans, reason: "llm" };
          }
        }
      } catch {
        // ignore LLM failures; keep heuristic pick
      }
    }

    const payload = {
      status: picked.status,
      samples_used: rows.length,
      window_days: DAYS_WINDOW,
    };

    if (INCLUDE_DEBUG) payload._debug = ev;

    return res.status(200).json(payload);
  } catch (e) {
    console.error("status-auto error:", e);
    return res.status(500).json({ error: "server error" });
  }
}
