import { syncChats } from './_utils/syncChats.js'; // or however you named it

export const config = {
  schedule: '0 */12 * * *' // Every 12 hours (UTC)
};

export default async function handler(req, res) {
  try {
    console.log('🔄 Running scheduled chat sync');
    const result = await syncChats(); // Your logic goes here
    res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error('❌ Chat sync failed:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
