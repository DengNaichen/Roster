import { z } from 'zod';
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
export const specContentSchema = z.strictObject({
  title: nonblank,
  status: z.enum(['draft', 'review', 'approved', 'superseded']),
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
const message = z.string().refine(
  (value) =>
    Array.from(value).length <= 240 && !/\p{Cc}/u.test(value) && Array.from(value).every((c) => {
      const code = c.codePointAt(0)!;
      return code < 0xD800 || code > 0xDFFF;
    }),
  'Message must be a single line of at most 240 Unicode characters',
);
const identifier = z.string().regex(/^SPEC-[1-9][0-9]*$/);
export const listSpecsSchema = z.strictObject({ team: z.string().optional() });
export const getSpecSchema = z.strictObject({ identifier });
export const listSpecRevisionsSchema = getSpecSchema;
export const createSpecSchema = z.strictObject({
  team: z.string().min(1),
  content: specContentSchema,
  message: message.optional(),
});
export const updateSpecSchema = z.strictObject({
  identifier,
  base_revision: z.number().int().min(1).max(2147483647),
  content: specContentSchema,
  message: message.optional(),
});
export const getSpecRevisionSchema = z.strictObject({
  identifier,
  number: z.number().int().min(1).max(2147483647),
});
export type SpecContent = z.output<typeof specContentSchema>;
export type SpecContentJSON = SpecContent;
export type SpecStory = z.output<typeof specStorySchema>;
export type SpecSummary = {
  identifier: string;
  team: string;
  title: string;
  status: SpecContent['status'];
  revision: number;
  updated_at: string;
};
export type Spec = {
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
