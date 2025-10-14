import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const COLORS = {
  header: rgb(177 / 255, 66 / 255, 180 / 255), // #b142b4
  headerAlt: rgb(194 / 255, 123 / 255, 255 / 255), // #c27bff
  text: rgb(36 / 255, 41 / 255, 46 / 255)
};

const MARGIN = 56;
const TITLE_SIZE = 20;
const SUBTITLE_SIZE = 12;
const SECTION_SIZE = 16;
const USER_SIZE = 13;
const ENTRY_SIZE = 12;

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
    const { height: newHeight } = page.getSize();
    cursorY = newHeight - MARGIN;
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
  color = COLORS.text,
  lineGap = 4,
  maxWidth,
  x = MARGIN
}) => {
  if (!text) return { page, cursorY };
  const lines = Array.isArray(text) ? text : wrapText(text, font, size, maxWidth);
  if (!lines.length) return { page, cursorY };

  const lineHeight = size + lineGap;
  for (const line of lines) {
    ({ page, cursorY } = ensureSpace(pdfDoc, page, cursorY, lineHeight));
    page.drawText(line, {
      x,
      y: cursorY - size,
      font,
      size,
      color
    });
    cursorY -= lineHeight;
  }

  return { page, cursorY };
};

const tryParseDate = value => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatShortDate = value => {
  const date = tryParseDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const isTaskObject = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    'description' in value ||
    'title' in value ||
    'name' in value ||
    'summary' in value ||
    'details' in value ||
    'tg_username' in value ||
    'username' in value ||
    'owner' in value ||
    'assignee' in value
  );
};

const normalizeTasks = input => {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.flatMap(item => normalizeTasks(item));
  }
  if (isTaskObject(input)) {
    return [input];
  }
  if (typeof input === 'object') {
    return Object.values(input).flatMap(item => normalizeTasks(item));
  }
  return [];
};

const groupTasksByUsername = tasks => {
  const groups = new Map();
  for (const task of tasks) {
    const username =
      sanitizeText(
        task.tg_username ??
          task.username ??
          task.owner ??
          task.assignee ??
          task.person ??
          task.member
      ) || 'Unassigned';
    if (!groups.has(username)) {
      groups.set(username, []);
    }
    groups.get(username).push(task);
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([username, userTasks]) => ({ username, tasks: userTasks }));
};

const getTaskField = (task, keys) => {
  for (const key of keys) {
    if (task && task[key] != null && task[key] !== '') return task[key];
  }
  return undefined;
};

  const getTaskDescription = task => {
  const description = getTaskField(task, [
    'description',
    'title',
    'name',
    'summary',
    'details',
    'task'
  ]);
  return sanitizeText(description) || 'No description provided';
};

const getTaskDate = (task, keys) => {
  const value = getTaskField(task, keys);
  return tryParseDate(value);
};

const sortTasksByDate = (tasks, keys) => {
  return tasks.slice().sort((a, b) => {
    const dateA = getTaskDate(a, keys);
    const dateB = getTaskDate(b, keys);
    if (dateA && dateB) return dateB - dateA;
    if (dateA) return -1;
    if (dateB) return 1;
    return 0;
  });
};

const drawCenteredText = ({
  pdfDoc,
  page,
  cursorY,
  text,
  font,
  size,
  color,
  lineGap = 8
}) => {
  if (!text) return { page, cursorY };
  ({ page, cursorY } = ensureSpace(pdfDoc, page, cursorY, size + lineGap));
  const { width } = page.getSize();
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = Math.max(MARGIN, (width - textWidth) / 2);
  page.drawText(text, {
    x,
    y: cursorY - size,
    font,
    size,
    color
  });
  cursorY -= size + lineGap;
  return { page, cursorY };
};

const drawSectionHeading = ({ pdfDoc, page, cursorY, text, font }) => {
  const size = SECTION_SIZE;
  const lineGap = 10;
  ({ page, cursorY } = ensureSpace(pdfDoc, page, cursorY, size + lineGap));
  page.drawText(text, {
    x: MARGIN,
    y: cursorY - size,
    font,
    size,
    color: COLORS.header
  });
  cursorY -= size + lineGap;
  return { page, cursorY };
};

const drawUserHeading = ({ pdfDoc, page, cursorY, text, font }) => {
  const size = USER_SIZE;
  const lineGap = 6;
  ({ page, cursorY } = ensureSpace(pdfDoc, page, cursorY, size + lineGap));
  page.drawText(text, {
    x: MARGIN,
    y: cursorY - size,
    font,
    size,
    color: COLORS.headerAlt
  });
  cursorY -= size + lineGap;
  return { page, cursorY };
};

const drawBulletItem = ({
  pdfDoc,
  page,
  cursorY,
  text,
  font,
  size,
  color,
  maxWidth,
  lineGap = 4,
  afterGap = 4
}) => {
  const sanitized = sanitizeText(text);
  if (!sanitized) return { page, cursorY };

  const bullet = '• ';
  const bulletWidth = font.widthOfTextAtSize(bullet, size);
  const effectiveMaxWidth = Math.max(1, (maxWidth ?? getPageMaxWidth(page)) - bulletWidth);
  const lines = wrapText(sanitized, font, size, effectiveMaxWidth);
  if (!lines.length) return { page, cursorY };

  const lineHeight = size + lineGap;
  for (let index = 0; index < lines.length; index += 1) {
    ({ page, cursorY } = ensureSpace(pdfDoc, page, cursorY, lineHeight));
    const isFirstLine = index === 0;
    const x = MARGIN + (isFirstLine ? 0 : bulletWidth);
    const content = isFirstLine ? `${bullet}${lines[index]}` : lines[index];
    page.drawText(content, {
      x,
      y: cursorY - size,
      font,
      size,
      color
    });
    cursorY -= lineHeight;
  }

  cursorY -= afterGap;
  return { page, cursorY };
};

const getPeriodRange = period => {
  const from = sanitizeText(
    get(period ?? {}, ['from', 'start', 'fromDate', 'startDate', 'begin'])
  );
  const to = sanitizeText(get(period ?? {}, ['to', 'end', 'endDate', 'finish']));
  if (!from && !to) return '';
  return `From ${from || '—'} to ${to || '—'}`;
};

const getPageMaxWidth = page => {
  const { width } = page.getSize();
  return width - MARGIN * 2;
};

/**
 * Generates a styled PDF summarising task activity for the team.
 *
 * @param {Object} data
 * @param {Object} [data.period]
 * @param {string} [data.period.from]
 * @param {string} [data.period.to]
 * @param {Array<Object>|Object} [data.activeTasks]
 * @param {Array<Object>|Object} [data.completedTasks]
 * @returns {Promise<Uint8Array>} Byte representation of the PDF document
 */
export async function generateTaskReportPdf(data = {}) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage();
  let cursorY = page.getSize().height - MARGIN;

  const headerFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  ({ page, cursorY } = drawCenteredText({
    pdfDoc,
    page,
    cursorY,
    text: 'Weekly Team Tasks Report',
    font: headerFont,
    size: TITLE_SIZE,
    color: COLORS.header
  }));

  const periodSource =
    data.period ?? {
      from: data.startDate ?? data.start ?? data.from,
      to: data.endDate ?? data.end ?? data.to
    };
  const periodLine = getPeriodRange(periodSource);
  if (periodLine) {
    ({ page, cursorY } = drawCenteredText({
      pdfDoc,
      page,
      cursorY,
      text: periodLine,
      font: bodyFont,
      size: SUBTITLE_SIZE,
      color: COLORS.text,
      lineGap: 6
    }));
  }

  const summary = sanitizeText(data.summary);
  if (summary) {
    cursorY -= 8;
    ({ page, cursorY } = drawTextBlock({
      pdfDoc,
      page,
      cursorY,
      text: summary,
      font: bodyFont,
      size: ENTRY_SIZE,
      color: COLORS.text,
      lineGap: 6,
      maxWidth: getPageMaxWidth(page)
    }));
  }

  cursorY -= 12;

  const completedTasks = normalizeTasks(data.completedTasks);
  const completedGroups = groupTasksByUsername(completedTasks);

  ({ page, cursorY } = drawSectionHeading({
    pdfDoc,
    page,
    cursorY,
    text: 'Section 1: Completed Tasks',
    font: headerFont
  }));

  if (!completedGroups.length) {
    ({ page, cursorY } = drawTextBlock({
      pdfDoc,
      page,
      cursorY,
      text: 'No completed tasks recorded during this period.',
      font: bodyFont,
      size: ENTRY_SIZE,
      color: COLORS.text,
      lineGap: 4,
      maxWidth: getPageMaxWidth(page)
    }));
    cursorY -= 16;
      } else {
        for (const { username, tasks } of completedGroups) {
      ({ page, cursorY } = drawUserHeading({
        pdfDoc,
        page,
        cursorY,
        text: username,
        font: headerFont
      }));
      const sortedTasks = sortTasksByDate(tasks, [
        'completed_at',
        'completedAt',
        'done_at',
        'completedAtUtc'
      ]);

      for (const task of sortedTasks) {
        const description = getTaskDescription(task);
        const completedOn = formatShortDate(
          getTaskField(task, ['completed_at', 'completedAt', 'done_at', 'date'])
        );
        const entryText = completedOn ? `${description} — ${completedOn}` : description;
        ({ page, cursorY } = drawBulletItem({
          pdfDoc,
          page,
          cursorY,
          text: entryText,
          font: bodyFont,
          size: ENTRY_SIZE,
          color: COLORS.text,
          maxWidth: getPageMaxWidth(page),
          lineGap: 4,
          afterGap: 4
        }));
      }

      cursorY -= 8;
    }
  }

  cursorY -= 8;

  const activeTasks = normalizeTasks(data.activeTasks ?? data.tasks);
  ({ page, cursorY } = drawSectionHeading({
    pdfDoc,
    page,
    cursorY,
    text: 'Section 2: Active Tasks',
    font: headerFont
  }));

  if (!activeTasks.length) {
    ({ page, cursorY } = drawTextBlock({
      pdfDoc,
      page,
      cursorY,
      text: 'No active tasks at this time.',
      font: bodyFont,
      size: ENTRY_SIZE,
      color: COLORS.text,
      lineGap: 4,
      maxWidth: getPageMaxWidth(page)
    }));

    
    } else {
    const activeGroups = groupTasksByUsername(activeTasks);
    for (const { username, tasks } of activeGroups) {
      ({ page, cursorY } = drawUserHeading({
        pdfDoc,
        page,
        cursorY,
        text: username,
        font: headerFont
      }));

      const sortedTasks = sortTasksByDate(tasks, [
        'created_at',
        'createdAt',
        'started_at',
        'date'
      ]);

      for (const task of sortedTasks) {
        const description = getTaskDescription(task);
        const createdOn = formatShortDate(
          getTaskField(task, ['created_at', 'createdAt', 'started_at', 'date'])
        );
        const entryText = createdOn ? `${description} — ${createdOn}` : description;
        ({ page, cursorY } = drawBulletItem({
          pdfDoc,
          page,
          cursorY,
          text: entryText,
          font: bodyFont,
          size: ENTRY_SIZE,
          color: COLORS.text,
          maxWidth: getPageMaxWidth(page),
          lineGap: 4,
          afterGap: 4
        }));
      }
      
      cursorY -= 8;
    }
  }

  return pdfDoc.save();
}

export default generateTaskReportPdf;
