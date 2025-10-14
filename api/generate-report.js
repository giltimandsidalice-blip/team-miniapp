
-37

// /api/generate-report.js

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { pool } from './_db.js';

const COMPANY_BLUE = rgb(12 / 255, 74 / 255, 129 / 255);
const DARK_TEXT = rgb(45 / 255, 45 / 255, 45 / 255);
const LIGHT_TEXT = rgb(1, 1, 1);
const ACCENT = rgb(232 / 255, 119 / 255, 51 / 255);

const formatDate = value => {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

const sanitize = value => {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
};

const wrapText = (text, font, fontSize, maxWidth) => {
  const sanitized = sanitize(text);
  if (!sanitized) return [];

  const words = sanitized.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
};

const ensureSpace = (pdfDoc, page, cursorY, neededHeight, margin) => {
  const { height } = page.getSize();
  if (cursorY - neededHeight < margin) {
    page = pdfDoc.addPage();
    cursorY = height - margin;
  }
  return { page, cursorY };
};

const drawLines = ({
  pdfDoc,
  page,
  cursorY,
  lines,
  font,
  size,
  color,
  lineGap,
  margin,
  maxWidth,
  indent = 0
}) => {
  const lineHeight = size + lineGap;
  for (const text of lines) {
    ({ page, cursorY } = ensureSpace(pdfDoc, page, cursorY, lineHeight, margin));
    page.drawText(text, {
      x: margin + indent,
      y: cursorY - size,
      font,
      size,
      color
    });
    cursorY -= lineHeight;
  }
  return { page, cursorY };
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { startDate, endDate } = req.body || {};

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'missing_date_range' });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return res.status(400).json({ error: 'invalid_date_range' });
  }

  if (start > end) {
    return res.status(400).json({ error: 'invalid_date_range' });
  }

  try {
    const completedQuery = `
      SELECT description, tg_username, completed_at
      FROM public.past_tasks
      WHERE completed_at BETWEEN $1::timestamptz AND $2::timestamptz
      ORDER BY completed_at ASC
    `;
    const activeQuery = `
      SELECT description, tg_username
      FROM public.team_tasks
      ORDER BY description ASC
    `;

    const [completedResult, activeResult] = await Promise.all([
      pool.query(completedQuery, [start.toISOString(), end.toISOString()]),
      pool.query(activeQuery)
    ]);

    const completedTasks = completedResult.rows || [];
    const activeTasks = activeResult.rows || [];

    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const margin = 50;
    const maxWidth = width - margin * 2;

    const headerFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Header band
    page.drawRectangle({
      x: 0,
      y: height - 100,
      width,
      height: 100,
      color: COMPANY_BLUE
    });

    page.drawText('Team Miniapp – Task Report', {
      x: margin,
      y: height - 60,
      size: 24,
      font: headerFont,
      color: LIGHT_TEXT
    });

    page.drawText(`Period: ${formatDate(start)} → ${formatDate(end)}`, {
      x: margin,
      y: height - 82,
      size: 12,
      font: bodyFont,
      color: LIGHT_TEXT
    });

    let cursorY = height - 120;

    const drawSectionTitle = title => {
      const lineHeight = 18;
      ({ page, cursorY } = ensureSpace(pdfDoc, page, cursorY, lineHeight, margin));
      page.drawText(title, {
        x: margin,
        y: cursorY - 14,
        size: 14,
        font: headerFont,
        color: ACCENT
      });
      cursorY -= lineHeight;
    };

    const drawParagraph = (text, indent = 0) => {
      const lines = wrapText(text, bodyFont, 11, maxWidth - indent);
      if (!lines.length) return;
      ({ page, cursorY } = drawLines({
        pdfDoc,
        page,
        cursorY,
        lines,
        font: bodyFont,
        size: 11,
        color: DARK_TEXT,
        lineGap: 4,
        margin,
        maxWidth,
        indent
      }));
    };

    drawSectionTitle('Completed Tasks');
    if (!completedTasks.length) {
      drawParagraph('No completed tasks found for the selected period.');
    } else {
      for (const task of completedTasks) {
        const description = sanitize(task.description) || 'No description provided';
        const username = sanitize(task.tg_username) || 'Unknown teammate';
        const completedOn = formatDate(task.completed_at);
        drawParagraph(`• ${description}`);
        drawParagraph(`Completed by ${username} on ${completedOn}`, 16);
        cursorY -= 4;
      }
    }

    cursorY -= 12;

    drawSectionTitle('Active Tasks');
    if (!activeTasks.length) {
      drawParagraph('No active tasks at this time.');
    } else {
      for (const task of activeTasks) {
        const description = sanitize(task.description) || 'No description provided';
        const username = sanitize(task.tg_username) || 'Unassigned';
        drawParagraph(`• ${description}`);
        drawParagraph(`Assigned to ${username}`, 16);
        cursorY -= 4;
      }
    }

    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(pdfBytes);

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Team Miniapp Reports <reports@team-miniapp.dev>',
        to: ['valentina@example.com'],
        subject: 'Team Miniapp Task Report',
        text: 'Hi Valentina,\n\nPlease find attached the latest task report.\n\nThanks,\nTeam Miniapp',
        attachments: [
          {
            filename: 'task-report.pdf',
            content: pdfBuffer.toString('base64'),
            type: 'application/pdf'
          }
        ]
      })
    });

    if (!emailResponse.ok) {
      const message = await emailResponse.text();
      throw new Error(`Failed to send email: ${message}`);
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('generate-report error:', err);
    return res.status(500).json({
      error: 'failed_to_generate_report',
      details: err.message
    });
  }
}
