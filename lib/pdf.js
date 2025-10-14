import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const COMPANY_COLORS = {
  primary: rgb(13 / 255, 78 / 255, 135 / 255), // #0D4E87
  accent: rgb(235 / 255, 119 / 255, 52 / 255), // #EB7734
  neutral: rgb(36 / 255, 41 / 255, 46 / 255)
};

const MARGIN = 48;
const TITLE_SIZE = 24;
const SUBTITLE_SIZE = 14;
const BODY_SIZE = 11;

const get = (value, keys, fallback) => {
  for (const key of keys) {
    if (value && value[key]) return value[key];
  }
  return fallback;
};

const sanitizeText = value => {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
};

const wrapText = (text, font, size, maxWidth) => {
  const sanitized = sanitizeText(text);
  if (!sanitized) return [];

  const words = sanitized.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const tentative = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(tentative, size);
    if (width <= maxWidth) {
      current = tentative;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
};

const ensureSpace = (pdfDoc, page, cursorY, neededHeight) => {
  const { height } = page.getSize();
  if (cursorY - neededHeight < MARGIN) {
    page = pdfDoc.addPage();
    cursorY = height - MARGIN;
  }
  return { page, cursorY };
};

const drawTextBlock = ({
  pdfDoc,
  page,
  cursorY,
  text,
  font,
  size,
  color = COMPANY_COLORS.neutral,
  lineGap = 4,
  maxWidth
}) => {
  if (!text) return { page, cursorY };
  const lines = Array.isArray(text) ? text : wrapText(text, font, size, maxWidth);
  if (!lines.length) return { page, cursorY };

  const lineHeight = size + lineGap;
  for (const line of lines) {
    ({ page, cursorY } = ensureSpace(pdfDoc, page, cursorY, lineHeight));
    page.drawText(line, {
      x: MARGIN,
      y: cursorY - size,
      font,
      size,
      color
    });
    cursorY -= lineHeight;
  }

  return { page, cursorY };
};

const describeTask = task => {
  if (!task) return '';
  const owner = sanitizeText(task.username ?? task.owner ?? task.assignee ?? task.person);
  const title = sanitizeText(task.title ?? task.name ?? task.description ?? task.summary);
  const status = sanitizeText(task.status ?? (task.completed ? 'Completed' : task.state));
  const date = sanitizeText(
    task.date ?? task.dueDate ?? task.deadline ?? task.completedAt ?? task.createdAt
  );
  const notes = sanitizeText(task.notes ?? task.details);

  const parts = [];
  if (owner) parts.push(owner);
  if (title) {
    if (parts.length) {
      parts[parts.length - 1] = `${parts[parts.length - 1]} – ${title}`;
    } else {
      parts.push(title);
    }
  }

  const meta = [];
  if (status) meta.push(status);
  if (date) meta.push(date);
  if (meta.length) parts.push(`(${meta.join(' • ')})`);
  if (notes) parts.push(`Notes: ${notes}`);

  return parts.join(' ');
};

/**
 * Generates a styled PDF summarising task activity for the team.
 *
 * @param {Object} data
 * @param {Object} [data.company]
 * @param {string} [data.company.name]
 * @param {string} [data.company.tagline]
 * @param {Object} [data.period]
 * @param {string} [data.period.from]
 * @param {string} [data.period.to]
 * @param {string} [data.summary]
 * @param {Array<Object>} [data.activeTasks]
 * @param {Object<string,Array<Object>>} [data.completedTasks]
 * @returns {Promise<Uint8Array>} Byte representation of the PDF document
 */
export async function generateTaskReportPdf(data = {}) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();

  const headerFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Header band
  page.drawRectangle({
    x: 0,
    y: height - 96,
    width,
    height: 96,
    color: COMPANY_COLORS.primary
  });

  const companyName = sanitizeText(get(data.company ?? {}, ['name', 'title'], 'Team Miniapp'));
  const tagline = sanitizeText(get(data.company ?? {}, ['tagline', 'subtitle'], 'Task Activity Report'));

  page.drawText(companyName || 'Team Miniapp', {
    x: MARGIN,
    y: height - 56,
    size: TITLE_SIZE,
    font: headerFont,
    color: rgb(1, 1, 1)
  });

  if (tagline) {
    page.drawText(tagline, {
      x: MARGIN,
      y: height - 82,
      size: SUBTITLE_SIZE,
      font: bodyFont,
      color: rgb(1, 1, 1)
    });
  }

  page.drawLine({
    start: { x: MARGIN, y: height - 108 },
    end: { x: width - MARGIN, y: height - 108 },
    thickness: 2,
    color: COMPANY_COLORS.accent
  });

  let cursorY = height - 128;
  const maxWidth = width - MARGIN * 2;

  const periodFrom = sanitizeText(get(data.period ?? {}, ['from', 'start']));
  const periodTo = sanitizeText(get(data.period ?? {}, ['to', 'end']));
  const periodLine = periodFrom || periodTo ? `Period: ${periodFrom || '—'} → ${periodTo || '—'}` : '';
  const generatedLine = `Generated: ${new Date().toLocaleString()}`;

  ({ page, cursorY } = drawTextBlock({
    pdfDoc,
    page,
    cursorY,
    text: [periodLine, generatedLine].filter(Boolean),
    font: bodyFont,
    size: BODY_SIZE,
    color: COMPANY_COLORS.neutral,
    lineGap: 2,
    maxWidth
  }));

  if (data.summary) {
    ({ page, cursorY } = drawTextBlock({
      pdfDoc,
      page,
      cursorY: cursorY - 12,
      text: data.summary,
      font: bodyFont,
      size: BODY_SIZE,
      color: COMPANY_COLORS.neutral,
      lineGap: 4,
      maxWidth
    }));
  }

  const activeTasks = Array.isArray(data.activeTasks) ? data.activeTasks : Array.isArray(data.tasks) ? data.tasks : [];
  if (activeTasks.length) {
    ({ page, cursorY } = drawTextBlock({
      pdfDoc,
      page,
      cursorY: cursorY - 20,
      text: 'Active Tasks',
      font: headerFont,
      size: SUBTITLE_SIZE,
      color: COMPANY_COLORS.primary,
      lineGap: 6,
      maxWidth
    }));

    for (const task of activeTasks) {
      ({ page, cursorY } = drawTextBlock({
        pdfDoc,
        page,
        cursorY,
        text: describeTask(task),
        font: bodyFont,
        size: BODY_SIZE,
        color: COMPANY_COLORS.neutral,
        lineGap: 4,
        maxWidth
      }));
    }
  }

  const completedTasks = data.completedTasks && typeof data.completedTasks === 'object' ? data.completedTasks : {};
  const completedMonths = Object.keys(completedTasks);
  if (completedMonths.length) {
    ({ page, cursorY } = drawTextBlock({
      pdfDoc,
      page,
      cursorY: cursorY - 20,
      text: 'Completed Tasks',
      font: headerFont,
      size: SUBTITLE_SIZE,
      color: COMPANY_COLORS.primary,
      lineGap: 6,
      maxWidth
    }));

    for (const month of completedMonths) {
      ({ page, cursorY } = drawTextBlock({
        pdfDoc,
        page,
        cursorY: cursorY - 6,
        text: month,
        font: headerFont,
        size: BODY_SIZE + 1,
        color: COMPANY_COLORS.accent,
        lineGap: 4,
        maxWidth
      }));

      const monthTasks = Array.isArray(completedTasks[month]) ? completedTasks[month] : [];
      for (const task of monthTasks) {
        ({ page, cursorY } = drawTextBlock({
          pdfDoc,
          page,
          cursorY,
          text: describeTask({ ...task, status: task.status ?? 'Completed' }),
          font: bodyFont,
          size: BODY_SIZE,
          color: COMPANY_COLORS.neutral,
          lineGap: 4,
          maxWidth
        }));
      }
    }
  }

  return pdfDoc.save();
}

export default generateTaskReportPdf;
