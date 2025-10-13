// /api/generate-report.js
import { q } from './_db'; // or however you query Supabase

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { startDate, endDate } = req.body || {};
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Missing start or end date' });
  }

  try {
    // Get completed tasks in range
    const { rows: completed } = await q(
      `SELECT tg_username, description, completed_at
         FROM past_tasks
        WHERE completed_at BETWEEN $1 AND $2
        ORDER BY completed_at ASC`,
      [startDate, endDate]
    );

    // Get active tasks (not completed yet)
    const { rows: active } = await q(
      `SELECT tg_username, description, created_at
         FROM team_tasks
        ORDER BY created_at ASC`
    );

    return res.status(200).json({
      period: { startDate, endDate },
      reportCreatedAt: new Date().toISOString(),
      completedTasks: completed,
      activeTasks: active,
    });
  } catch (err) {
    console.error("generate-report error:", err);
    return res.status(500).json({ error: "Failed to generate report" });
  }
}
