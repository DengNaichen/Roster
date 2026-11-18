import type {
  IssueBlock,
  IssueCriterion,
  IssueDocument,
  IssueSection,
} from '../../../../contracts/issue-document.ts';
import { AppError } from '../../../../contracts/mod.ts';

type ListItem = { title?: string; text: string };

const CRITERIA_HEADING = /^(acceptance\s+criteria|criteria|验收标准)$/i;
const HEADING_LINE = /^#{1,2}\s+(.+)$/;
const SUBHEADING_LINE = /^###+\s+(.+)$/;
const HR_LINE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_LINE = /^```/;
const COMPARE_OPEN = /^:::\s*compare\s*$/i;
const COMPARE_CLOSE = /^:::\s*$/;
const UL_LINE = /^[-*]\s+(.+)$/;
const OL_LINE = /^\d+\.\s+(.+)$/;
const TABLE_ROW = /^\|(.+)\|\s*$/;
const TABLE_SEP = /^\|\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|\s*$/;
const NOTE_LINE = /^>\s?(.*)$/;
const CRITERION_LINE = /^(?:[-*]|\d+\.)\s+\[([ xX])\]\s+(.+)$/;
const LEAD_LIMIT = 2000;

function splitCells(line: string): string[] {
  const inner = line.trim().slice(1, -1);
  return inner.split('|').map((cell) => cell.trim());
}

function parseListItem(raw: string): ListItem {
  const trimmed = raw.trim();
  const boldLead = /^\*\*([^*]+)\*\*(?::|：|\s+)?\s*(.*)$/.exec(trimmed);
  if (boldLead && boldLead[1].trim() && boldLead[2].trim()) {
    return { title: boldLead[1].trim(), text: boldLead[2].trim() };
  }
  return { text: trimmed };
}

function parseNote(lines: string[]): IssueBlock {
  const cleaned = lines.map((line) => NOTE_LINE.exec(line)?.[1] ?? line);
  let title: string | undefined;
  const first = cleaned[0]?.trim() ?? '';
  const callout = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(first);
  if (callout) {
    title = callout[2].trim() || callout[1][0].toUpperCase() + callout[1].slice(1).toLowerCase();
    cleaned.shift();
  } else {
    const boldTitle = /^\*\*([^*]+)\*\*(?::|：)?\s*(.*)$/.exec(first);
    if (boldTitle && boldTitle[1].trim()) {
      title = boldTitle[1].trim();
      const rest = boldTitle[2].trim();
      if (rest) cleaned[0] = rest;
      else cleaned.shift();
    }
  }
  const text = cleaned.join('\n').trim();
  if (!text) {
    throw new AppError('invalid_input', 'Note block cannot be empty');
  }
  return title ? { type: 'note', title, text } : { type: 'note', text };
}

function parseCompare(lines: string[]): IssueBlock {
  const sides: { title: string; items: string[] }[] = [];
  let current: { title: string; items: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const subheading = /^###\s+(.+)$/.exec(line);
    if (subheading) {
      current = { title: subheading[1].trim(), items: [] };
      sides.push(current);
      continue;
    }
    if (!current) {
      throw new AppError(
        'invalid_input',
        'Compare block must start with a `### Left title` subheading. Example: ::: compare\\n### In scope\\n- item\\n### Out of scope\\n- item\\n:::',
      );
    }
    const bullet = UL_LINE.exec(line) ?? OL_LINE.exec(line);
    current.items.push(bullet ? bullet[1].trim() : line);
  }
  if (sides.length !== 2 || !sides[0].items.length || !sides[1].items.length) {
    throw new AppError(
      'invalid_input',
      'Compare block requires exactly two `###` sides, each with at least one item. Example: ::: compare\\n### In scope\\n- item\\n### Out of scope\\n- item\\n:::',
    );
  }
  return { type: 'compare', left: sides[0], right: sides[1] };
}

function parseBlocks(lines: string[]): IssueBlock[] {
  const blocks: IssueBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || HR_LINE.test(trimmed)) {
      i++;
      continue;
    }
    const subheading = SUBHEADING_LINE.exec(trimmed);
    if (subheading) {
      blocks.push({ type: 'paragraph', text: subheading[1].trim() });
      i++;
      continue;
    }
    if (FENCE_LINE.test(trimmed)) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !FENCE_LINE.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i >= lines.length) {
        throw new AppError('invalid_input', 'Unclosed fenced code block: missing closing ```');
      }
      i++;
      const text = codeLines.join('\n').replace(/^\n+|\n+$/g, '');
      if (text) blocks.push({ type: 'code', text });
      continue;
    }
    if (COMPARE_OPEN.test(trimmed)) {
      i++;
      const inner: string[] = [];
      while (i < lines.length && !COMPARE_CLOSE.test(lines[i].trim())) {
        inner.push(lines[i]);
        i++;
      }
      if (i >= lines.length) {
        throw new AppError('invalid_input', 'Unclosed `::: compare` block: missing closing `:::`');
      }
      i++;
      blocks.push(parseCompare(inner));
      continue;
    }
    if (
      i + 1 < lines.length &&
      TABLE_ROW.test(trimmed) &&
      TABLE_SEP.test(lines[i + 1].trim())
    ) {
      const columns = splitCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i].trim())) {
        rows.push(splitCells(lines[i].trim()));
        i++;
      }
      if (!rows.length) {
        throw new AppError('invalid_input', 'Table block requires at least one data row');
      }
      blocks.push({ type: 'table', columns, rows });
      continue;
    }
    if (NOTE_LINE.test(trimmed)) {
      const noteLines: string[] = [];
      while (i < lines.length && NOTE_LINE.test(lines[i].trim())) {
        noteLines.push(lines[i].trim());
        i++;
      }
      blocks.push(parseNote(noteLines));
      continue;
    }
    if (UL_LINE.test(trimmed) || OL_LINE.test(trimmed)) {
      const ordered = OL_LINE.test(trimmed);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        const match = ordered ? OL_LINE.exec(current) : UL_LINE.exec(current);
        if (!match) break;
        items.push(parseListItem(match[1]));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const current = lines[i].trim();
      if (
        !current ||
        HR_LINE.test(current) ||
        SUBHEADING_LINE.test(current) ||
        FENCE_LINE.test(current) ||
        COMPARE_OPEN.test(current) ||
        NOTE_LINE.test(current) ||
        UL_LINE.test(current) ||
        OL_LINE.test(current) ||
        (i + 1 < lines.length && TABLE_ROW.test(current) && TABLE_SEP.test(lines[i + 1].trim()))
      ) {
        break;
      }
      paragraphLines.push(current);
      i++;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }
  return blocks;
}

function parseCriteria(lines: string[]): IssueCriterion[] {
  const parsed: { id: string | null; title: string; detail: string; done: boolean }[] = [];
  const used = new Set<string>();
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = CRITERION_LINE.exec(trimmed);
    if (!match) {
      throw new AppError(
        'invalid_input',
        `Acceptance criteria items must use "- [ ] ..." checklist syntax: ${trimmed}`,
      );
    }
    const done = match[1].toLowerCase() === 'x';
    let rest = match[2].trim();
    let id: string | null = null;
    const idMatch = /^(?:\[(AC-[1-9][0-9]*)\]|(AC-[1-9][0-9]*)(?::|：)?)\s+(.+)$/i.exec(rest);
    if (idMatch) {
      id = (idMatch[1] ?? idMatch[2]).toUpperCase();
      used.add(id);
      rest = idMatch[3].trim();
    }
    let title = rest;
    let detail = '';
    const boldSplit = /^\*\*([^*]+)\*\*(?::|：|\s+—\s+|\s+-\s+|\s+)?(.*)$/.exec(rest);
    if (boldSplit && boldSplit[1].trim()) {
      title = boldSplit[1].trim();
      detail = boldSplit[2].trim();
    } else {
      const sepSplit = /^(.+?)(?:\s+—\s+|:\s+|：\s*)(.+)$/.exec(rest);
      if (sepSplit) {
        title = sepSplit[1].trim();
        detail = sepSplit[2].trim();
      }
    }
    parsed.push({ id, title, detail, done });
  }
  let next = 1;
  return parsed.map((entry) => {
    let id = entry.id;
    if (!id) {
      while (used.has(`AC-${next}`)) next++;
      id = `AC-${next}`;
      used.add(id);
    }
    return { id, title: entry.title, detail: entry.detail, done: entry.done };
  });
}

/** Parse concise Markdown into a structured IssueDocument for web rendering and AC tracking. */
export function parseIssueDocumentMarkdown(markdown: string): IssueDocument {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const preamble: string[] = [];
  const rawSections: { title: string; lines: string[] }[] = [];
  let inFence = false;

  for (const line of lines) {
    if (FENCE_LINE.test(line.trim())) inFence = !inFence;
    const heading = !inFence ? HEADING_LINE.exec(line.trim()) : null;
    if (heading) {
      rawSections.push({ title: heading[1].trim(), lines: [] });
    } else if (rawSections.length) {
      rawSections[rawSections.length - 1].lines.push(line);
    } else {
      preamble.push(line);
    }
  }

  let lead = '';
  const sections: IssueSection[] = [];
  const criteria: IssueCriterion[] = [];

  const preambleBlocks = parseBlocks(preamble);
  if (preambleBlocks.length > 0) {
    if (
      preambleBlocks[0].type === 'paragraph' &&
      Array.from(preambleBlocks[0].text).length <= LEAD_LIMIT
    ) {
      lead = preambleBlocks[0].text;
      if (preambleBlocks.length > 1) {
        sections.push({ title: 'Description', blocks: preambleBlocks.slice(1) });
      }
    } else {
      sections.push({ title: 'Description', blocks: preambleBlocks });
    }
  }

  for (const section of rawSections) {
    if (CRITERIA_HEADING.test(section.title)) {
      criteria.push(...parseCriteria(section.lines));
      continue;
    }
    const blocks = parseBlocks(section.lines);
    if (!blocks.length) {
      throw new AppError('invalid_input', `Section "${section.title}" cannot be empty`);
    }
    sections.push({ title: section.title, blocks });
  }

  return { lead, sections, criteria };
}
