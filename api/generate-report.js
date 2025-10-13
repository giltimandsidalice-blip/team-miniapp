// /api/generate-report.js

import { q } from './_db.js'; // helper to query Supabase with service role

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { startDate, endDate } = req.body || {};

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'missing_date_range' });
  }

  try {
    // Fetch completed (past) tasks
    const completed = await q(
      `
      SELECT tg_username, description, completed_at
      FROM past_tasks
      WHERE completed_at BETWEEN $1 AND $2
      ORDER BY completed_at ASC
      `,
      [startDate, endDate]
    );

    // Group completed tasks by month
    const completedGrouped = {};
    for (const row of completed.rows) {
      const date = new Date(row.completed_at);
      const monthYear = date.toLocaleString('default', {
        month: 'long',
        year: 'numeric'
      });

      if (!completedGrouped[monthYear]) {
        completedGrouped[monthYear] = [];
      }

      completedGrouped[monthYear].push({
        username: row.tg_username,
        description: row.description,
        date: date.toISOString().split('T')[0]
      });
    }

    // Fetch active tasks (still open)
    const active = await q(
      `
      SELECT tg_username, description, created_at
      FROM team_tasks
      ORDER BY created_at ASC
      `
    );

    const activeTasks = active.rows.map(row => ({
      username: row.tg_username,
      description: row.description,
      date: new Date(row.created_at).toISOString().split('T')[0]
    }));

    // Return the report data
    return res.status(200).json({
      success: true,
      report: {
        period: {
          from: startDate,
          to: endDate
        },
        completedTasks: completedGrouped,
        activeTasks: activeTasks
      }
    });
  } catch (err) {
    console.error('generate-report error:', err);
    return res.status(500).json({
      error: 'failed_to_generate_report',
      details: err.message
    });
  }
}
