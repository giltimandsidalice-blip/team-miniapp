// api/timeline-campaign.js (ESM)
// Campaign launches — explicitly includes campaign context

import { ensureAuth, findTimelineItems } from "./_timeline_common.js";

function wantsCampaign(text) {
  const t = text.toLowerCase();

  // Must mention a campaign AND some form of launch/go-live
  const hasCampaign =
    /\bcampaign\b/.test(t) ||
    /\bкампания\b/.test(t) ||
    /\bколлаб\b|\bkol\b|\bинфлюенсер\b|\bреферал\b/.test(t); // mild hints

  const hasLaunch =
    /\b(launch|go live|went live|live now|kick off|kickoff|start)\b/.test(t) ||
    /\b(запуск|старт|вышла|пошла в эфир)\b/.test(t);

  return hasCampaign && hasLaunch;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!ensureAuth(req, res)) return;

  try {
    const items = await findTimelineItems({
      chatIdsLimit: 1000,
      perChatLimit: 400,
      wantFn: wantsCampaign
    });

    res.json({ items, generated_at: new Date().toISOString() });
  } catch (e) {
    console.error("timeline-campaign error:", e);
    res.status(500).json({ error: "server error" });
  }
}
