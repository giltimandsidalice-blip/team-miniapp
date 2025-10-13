import { q } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tg_username, tg_user_id, description } = req.body || {};

  if (!tg_username || !description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await q(
      `INSERT INTO past_tasks (tg_username, tg_user_id, description)
       VALUES ($1, $2, $3)`,
      [tg_username, tg_user_id || null, description]
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('log-task error:', err);
    return res.status(500).json({ error: 'Failed to log task' });
  }
}
