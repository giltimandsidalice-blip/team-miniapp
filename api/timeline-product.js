// api/timeline-product.js (ESM)
// Product/service/site launches — excludes "campaign" context

import { ensureAuth, findTimelineItems } from "./_timeline_common.js";

function wantsProduct(text) {
  const t = text.toLowerCase();

  // Must mention launch intent but NOT campaign
  const hasLaunch =
    /\b(launch|release|go live|ship|publish|open|open beta|beta|v\d+|website launch|site launch|go-live)\b/.test(t) ||
    /\b(релиз|запуск|старт|выходит|ввод в эксплуатацию|открытие|бета)\b/.test(t);

  const mentionsCampaign =
    /\bcampaign\b/.test(t) ||
    /\bкампания\b/.test(t);

  return hasLaunch && !mentionsCampaign;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!ensureAuth(req, res)) return;

  try {
    const items = await findTimelineItems({
      chatIdsLimit: 1000,
      perChatLimit: 400,
      wantFn: wantsProduct
    });

    // Only return items that have at least a month (already ensured by parser)
    res.json({ items, generated_at: new Date().toISOString() });
  } catch (e) {
    console.error("timeline-product error:", e);
    res.status(500).json({ error: "server error" });
  }
}
