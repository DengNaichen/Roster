import { z } from 'zod';
import { specStatuses } from './spec-status.ts';
import type { Identity } from './mod.ts';
function validUnicode(value: unknown): boolean {
  if (typeof value === 'string') {
    return Array.from(value).every((c) => {
      const point = c.codePointAt(0)!;
      return point < 0xD800 || point > 0xDFFF;
    });
  }
  if (Array.isArray(value)) return value.every(validUnicode);
  if (value && typeof value === 'object') return Object.values(value).every(validUnicode);
  return true;
}
const nonblank = z.string().refine((v) => v.trim().length > 0, 'Must not be blank');
const list = <T extends z.ZodType>(item: T) =>
  z.array(item).nullish().transform((value) => value ?? []);
const calendar = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Expected a calendar date YYYY-MM-DD');
const stable = (prefix: string) => z.string().regex(new RegExp('^' + prefix + '-[0-9]+$'));
export const specScenarioSchema = z.strictObject({
  given: nonblank,
  when: nonblank,
  then: nonblank,
});
export const specStorySchema = z.strictObject({
  id: stable('US'),
  title: nonblank,
  priority: z.enum(['P1', 'P2', 'P3']),
  description: nonblank,
  why: z.string().default(''),
  independent_test: z.string().default(''),
  scenarios: list(specScenarioSchema),
});
export const specRequirementSchema = z.strictObject({
  id: stable('FR'),
  text: nonblank,
  clarify: z.string().optional(),
});
export const specCriterionSchema = z.strictObject({ id: stable('SC'), text: nonblank });
const writableStatus = z.union([
  z.enum(specStatuses),
  z.literal('approved').transform(() => 'active' as const),
]);
export const specStoredStatusSchema = z.union([writableStatus, z.literal('superseded')]);
export const specContentSchema = z.strictObject({
  title: nonblank,
  status: specStoredStatusSchema,
  branch: z.string().optional(),
  stories: list(specStorySchema),
  edge_cases: list(z.string()),
  requirements: list(specRequirementSchema),
  entities: list(z.strictObject({ name: nonblank, description: nonblank })),
  success_criteria: list(specCriterionSchema),
  clarifications: list(
    z.strictObject({
      date: calendar,
      items: list(z.strictObject({ question: nonblank, answer: nonblank })),
    }),
  ),
}).superRefine((content, ctx) => {
  if (!validUnicode(content)) {
    ctx.addIssue({ code: 'custom', message: 'Content must contain valid Unicode' });
  }
  const ids = new Set<string>();
  for (const entry of [...content.stories, ...content.requirements, ...content.success_criteria]) {
    if (ids.has(entry.id)) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate stable ID ' + entry.id });
    }
    ids.add(entry.id);
  }
});
// Accept the old spelling from existing clients without writing it into new revisions.
const writableContent = specContentSchema.safeExtend({
  status: writableStatus,
});
const message = z.string().refine(
  (value) =>
    Array.from(value).length <= 240 && !/\p{Cc}/u.test(value) && Array.from(value).every((c) => {
      const code = c.codePointAt(0)!;
      return code < 0xD800 || code > 0xDFFF;
    }),
  'Message must be a single line of at most 240 Unicode characters',
);
const identifier = z.string().regex(/^SPEC-[1-9][0-9]*$/);
const diagram = (header: string) =>
  z.string().refine(
    (source) =>
      !source.trim() || (source.trimStart().split(/\s/)[0] === header && !source.includes('%%{')),
    'Expected ' + header + ' without configuration directives',
  ).default('');
export const designContentSchema = z.strictObject({
  context: z.string().default(''),
  goals: z.string().default(''),
  nonGoals: z.string().default(''),
  risks: z.string().default(''),
  decisions: z.array(
    z.strictObject({
      title: nonblank,
      reason: z.string().default(''),
      sequence: diagram('sequenceDiagram'),
      state: diagram('stateDiagram-v2'),
    }),
  ).min(1),
  notes: z.string().optional(),
}).refine(validUnicode, 'Invalid Unicode');
export const setSpecDesignSchema = z.strictObject({
  identifier,
  base_revision: z.number().int().min(0).max(2147483646),
  spec_revision: z.number().int().positive().max(2147483647),
  content: designContentSchema,
});
export const storedDesignSchema = z.object({
  revision: z.number().int().positive(),
  spec_revision: z.number().int().positive(),
  content: designContentSchema,
});
export type StoredDesign = z.output<typeof storedDesignSchema>;
export const listSpecsSchema = z.strictObject({ team: z.string().optional() });
export const getSpecSchema = z.strictObject({ identifier });
export const listSpecRevisionsSchema = getSpecSchema;
export const createSpecSchema = z.strictObject({
  team: z.string().min(1),
  content: writableContent,
  message: message.optional(),
});
export const updateSpecSchema = z.strictObject({
  identifier,
  base_revision: z.number().int().min(1).max(2147483647),
  content: writableContent,
  message: message.optional(),
});
export const getSpecRevisionSchema = z.strictObject({
  identifier,
  number: z.number().int().min(1).max(2147483647),
});
export type EditableSpecContent = z.output<typeof writableContent>;
export type SpecContent = z.output<typeof specContentSchema>;
export type SpecContentJSON = SpecContent;
export type SpecStory = z.output<typeof specStorySchema>;
export type SpecIssueProgress = { done: number; total: number };
// The editable head (revision/content) can be newer than the version adopted by the team.
export type SpecActiveRevision = { number: number; title: string };
export type SpecSummary = {
  active_revision: SpecActiveRevision | null;
  issue_progress: SpecIssueProgress;
  identifier: string;
  team: string;
  title: string;
  status: SpecContent['status'];
  revision: number;
  updated_at: string;
};
export type Spec = {
  active_revision: SpecActiveRevision | null;
  issue_progress: SpecIssueProgress;
  identifier: string;
  team: string;
  revision: number;
  message: string;
  author: Identity | null;
  created_at: string;
  updated_at: string;
  content: SpecContent;
};
export type SpecRevisionSummary = {
  number: number;
  message: string;
  author: Identity | null;
  created_at: string;
};
export type SpecRevision = SpecRevisionSummary & { content: SpecContent };

const issueIdentifier = z.string().trim().min(1).max(100);
export const changeSpecIssuesSchema = z.strictObject({
  identifier,
  issues: z.array(issueIdentifier).min(1).max(100).transform((value) => [...new Set(value)]),
});
export const specIssueSchema = z.strictObject({ identifier, issue: issueIdentifier });
export const listIssueSpecsSchema = z.strictObject({ issue: issueIdentifier });
export type SpecIssueChange = { identifier: string; issues: string[]; linked: boolean };

export const specDependenciesSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().uuid(),
    identifier: z.string(),
    title: z.string(),
    status: z.enum([
      'triage',
      'backlog',
      'todo',
      'agent_ready',
      'in_progress',
      'in_review',
      'done',
      'canceled',
    ]),
    external: z.boolean(),
    assignee: z.object({ subject: z.string(), name: z.string(), email: z.string() }).nullable(),
  })),
  edges: z.array(z.object({ from: z.string().uuid(), to: z.string().uuid() })),
});
export type SpecDependencies = z.output<typeof specDependenciesSchema>;
