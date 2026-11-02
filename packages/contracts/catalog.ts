import { z } from 'zod';
import emojiCatalog from './emoji.json' with { type: 'json' };
const id = z.number().int().positive().max(2147483647);
const name = z.string().trim().min(1).max(200);
const description = z.string().max(100000);
const teamKeys = z.array(z.string().regex(/^[A-Z][A-Z0-9]{1,5}$/)).min(1).max(1000);
const ref = {
  id: z.number().int().min(0).max(2147483647).optional(),
  name: z.string().max(200).optional(),
};
const date = z.string().refine((value) => {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Expected a calendar date YYYY-MM-DD or an empty string');
const emojiValues = new Set(['', ...emojiCatalog.map((entry) => entry.emoji)]);
export function isValidEmoji(value: unknown): value is string {
  return typeof value === 'string' && emojiValues.has(value);
}
const emoji = z.string().refine(
  isValidEmoji,
  'Expected a fully-qualified Unicode emoji or an empty string',
);
export const listProjectsSchema = z.strictObject({
  include_archived: z.boolean().optional(),
  team: z.string().optional(),
});
export const getProjectSchema = z.strictObject(ref).refine(
  (value) => (value.id ?? 0) > 0 || Boolean(value.name),
  'Project id or name is required',
);
export const createProjectSchema = z.strictObject({
  name,
  description: description.optional(),
  teams: teamKeys,
  emoji: emoji.optional(),
  start_date: date.optional(),
  target_date: date.optional(),
});
export const updateProjectSchema = z.strictObject({
  ...ref,
  new_name: name.optional(),
  description: description.optional(),
  teams: teamKeys.optional(),
  emoji: emoji.optional(),
  archived: z.boolean().optional(),
  start_date: date.optional(),
  target_date: date.optional(),
}).refine(
  (value) => (value.id ?? 0) > 0 || Boolean(value.name),
  'Project id or name is required',
);
export const listInitiativesSchema = z.strictObject({ include_archived: z.boolean().optional() });
export const getInitiativeSchema = z.strictObject({ id });
export const createInitiativeSchema = z.strictObject({
  name,
  description: description.optional(),
  project_ids: z.array(id).max(10000).optional(),
});
export const updateInitiativeSchema = z.strictObject({
  id,
  name: name.optional(),
  description: description.optional(),
  archived: z.boolean().optional(),
  project_ids: z.array(id).max(10000).optional(),
});
export const listLabelsSchema = z.strictObject({ include_archived: z.boolean().optional() });
export const listLabelGroupsSchema = z.strictObject({});
export const saveLabelGroupSchema = z.strictObject({
  id: z.number().int().min(0).max(2147483647).optional(),
  name,
});
export const createLabelSchema = z.strictObject({
  name,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: description.optional(),
  group_id: z.number().int().min(0).max(2147483647).optional(),
});
export const updateLabelSchema = z.strictObject({
  id,
  name: name.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  description: description.optional(),
  archived: z.boolean().optional(),
});
export const changeIssueLabelsSchema = z.strictObject({
  identifiers: z.array(z.string().min(1).max(100)).min(1).max(10000),
  add: z.array(id).max(10000).optional(),
  remove: z.array(id).max(10000).optional(),
});
export const mergeLabelsSchema = z.strictObject({ source_id: id, target_id: id }).refine(
  (value) => value.source_id !== value.target_id,
  'Merge requires distinct labels',
);
export type Project = {
  id: number;
  teams: string[];
  name: string;
  description: string;
  emoji: string;
  archived: boolean;
  start_date?: string;
  target_date?: string;
};
export type Initiative = {
  id: number;
  name: string;
  description: string;
  archived: boolean;
  project_ids: number[];
};
export type Label = {
  id: number;
  name: string;
  color: string;
  description: string;
  group_id: number;
  archived: boolean;
};
export type LabelGroup = { id: number; name: string };
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateInitiativeInput = z.infer<typeof createInitiativeSchema>;
export type UpdateInitiativeInput = z.infer<typeof updateInitiativeSchema>;
export type CreateLabelInput = z.infer<typeof createLabelSchema>;
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;
export type LabelFilterInput = {
  label_mode?: 'any' | 'all' | 'none' | 'unlabeled';
  label_ids?: number[];
  label_group_ids?: number[];
};
