import { z } from 'zod';

const inline =
  'Plain text. Wrap code, paths and endpoints in backticks; no other markup is interpreted.';
const text = (max: number) => z.string().trim().min(1).max(max).describe(inline);

const listItem = z.strictObject({
  title: text(200).optional().describe('Short bold lead-in such as "Reuse the list component."'),
  text: text(2000),
});
const side = z.strictObject({
  title: text(100).describe('For example "In scope" / "Out of scope", or "Expected" / "Actual".'),
  items: z.array(text(1000)).min(1).max(20),
});

export const issueBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('paragraph'), text: text(5000) }),
  z.strictObject({
    type: z.literal('list'),
    ordered: z.boolean().describe('true for steps or ranked items'),
    items: z.array(listItem).min(1).max(50),
  }),
  z.strictObject({
    type: z.literal('compare'),
    left: side.describe('Rendered highlighted, e.g. what is included or what is expected.'),
    right: side.describe('Rendered neutral, e.g. what is excluded or what actually happens.'),
  }).describe('Two columns side by side: scope in/out, or expected/actual for a bug.'),
  z.strictObject({
    type: z.literal('table'),
    columns: z.array(text(100)).min(1).max(8),
    rows: z.array(z.array(text(1000)).min(1).max(8)).min(1).max(50),
  }).refine((t) => t.rows.every((row) => row.length === t.columns.length), {
    message: 'Every table row needs one cell per column',
  }),
  z.strictObject({
    type: z.literal('note'),
    title: text(100).optional(),
    text: text(2000),
  }).describe('A highlighted caveat: an edge case, a risk, or something easy to get wrong.'),
  z.strictObject({ type: z.literal('code'), text: z.string().min(1).max(5000) })
    .describe('A preformatted block, shown verbatim.'),
]);

export const issueSectionSchema = z.strictObject({
  title: text(100).describe('Section heading without numbering; sections are numbered when shown.'),
  blocks: z.array(issueBlockSchema).min(1).max(30),
});

const criterionId = z.string().regex(/^AC-[1-9][0-9]*$/).describe('Stable ID such as AC-1');
export const issueCriterionSchema = z.strictObject({
  id: criterionId,
  title: text(200).describe('Observable outcome, e.g. "Blocked tasks are marked."'),
  detail: z.string().trim().max(2000).default('').describe(
    'How to verify it: the action and what should be seen.',
  ),
  done: z.boolean().default(false).describe(
    'Set true only after verifying the outcome; record the evidence in a work log.',
  ),
});

export const issueDocumentSchema = z.strictObject({
  lead: z.string().trim().max(2000).default('').describe(
    'One or two sentences: what changes for whom once this is done. ' + inline,
  ),
  sections: z.array(issueSectionSchema).max(20).default([]).describe(
    'Context the work needs, in reading order. Features usually use: goal, scope (compare), ' +
      'interaction, constraints. Bugs: reproduction steps (ordered list), expected vs actual (compare), clues.',
  ),
  criteria: z.array(issueCriterionSchema).max(30).default([]).describe(
    'Acceptance criteria, shown last as a checklist. Keep IDs stable when editing.',
  ),
}).superRefine((document, ctx) => {
  const seen = new Set<string>();
  document.criteria.forEach((criterion, index) => {
    if (seen.has(criterion.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['criteria', index, 'id'],
        message: 'Duplicate criterion ID ' + criterion.id,
      });
    }
    seen.add(criterion.id);
  });
}).describe('Structured issue body. Write the whole document; omitted fields become empty.');

export const checkIssueCriterionSchema = z.strictObject({
  criterion: criterionId,
  done: z.boolean(),
});

export type IssueBlock = z.output<typeof issueBlockSchema>;
export type IssueSection = z.output<typeof issueSectionSchema>;
export type IssueCriterion = z.output<typeof issueCriterionSchema>;
export type IssueDocument = z.output<typeof issueDocumentSchema>;
export type CheckIssueCriterionInput = z.output<typeof checkIssueCriterionSchema>;

export const emptyIssueDocument: IssueDocument = { lead: '', sections: [], criteria: [] };

function blockText(block: IssueBlock): string[] {
  switch (block.type) {
    case 'paragraph':
    case 'note':
      return [block.type === 'note' && block.title ? block.title : '', block.text];
    case 'code':
      return [block.text];
    case 'list':
      return block.items.map((item) => [item.title, item.text].filter(Boolean).join(' '));
    case 'compare':
      return [block.left, block.right].flatMap((s) => [s.title, ...s.items]);
    case 'table':
      return [block.columns.join(' | '), ...block.rows.map((row) => row.join(' | '))];
  }
}

// Plain-text rendering for search, notifications and integrations that cannot show the structure.
export function issueDocumentText(document: IssueDocument): string {
  return [
    document.lead,
    ...document.sections.flatMap((
      section,
    ) => [section.title, ...section.blocks.flatMap(blockText)]),
    ...document.criteria.map((c) =>
      `[${c.done ? 'x' : ' '}] ${c.title}${c.detail ? ' ' + c.detail : ''}`
    ),
  ].filter(Boolean).join('\n');
}
