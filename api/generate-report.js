// /api/generate-report.js

import { q } from './_db.js'; // helper to query Supabase with service role
import generatePdf from '../lib/pdf.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { startDate, endDate } = req.body || {};

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'missing_date_range' });
  }

  try {

    const completed = await q(
      `
      SELECT tg_username, description, completed_at
      FROM past_tasks
      WHERE completed_at BETWEEN $1 AND $2
      ORDER BY completed_at ASC
      `,
      [startDate, endDate]
    );

    const tasksByUser = {};
    for (const row of completed.rows) {
      const username = row.tg_username || 'Unknown';
      if (!tasksByUser[username]) {
        tasksByUser[username] = [];
      }

      tasksByUser[username].push({
        username,
        description: row.description,
        date: new Date(row.completed_at).toISOString().split('T')[0],
        completedAt: row.completed_at
      });
    }

    const pdfBuffer = await generatePdf({
      period: {
        from: startDate,
        to: endDate
      },
      summary: `Completed ${completed.rows.length} task${
        completed.rows.length === 1 ? '' : 's'
      } across ${Object.keys(tasksByUser).length || 0} teammate${
        Object.keys(tasksByUser).length === 1 ? '' : 's'
      }.`,
      completedTasks: tasksByUser
      
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="task-report.pdf"');
    return res.status(200).send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error('generate-report error:', err);
    return res.status(500).json({
      error: 'failed_to_generate_report',
      details: err.message
    });
  }
}
