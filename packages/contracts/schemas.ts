import { z } from 'zod';
import { isValidEmoji } from './catalog.ts';
const subject = z.string().uuid();
const status = z.enum([
  'triage',
  'backlog',
  'todo',
  'agent_ready',
  'in_progress',
  'in_review',
  'done',
  'canceled',
]);
const type = z.enum(['spec', 'feature', 'bug', 'improvement', 'chore']);
export const createWorkspaceSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().trim().min(1).max(200),
});
export const updateWorkspaceSchema = createWorkspaceSchema.pick({ name: true });
export const joinWorkspaceSchema = z.strictObject({ token: z.string().min(1).max(512) });
export const updateMemberSchema = z.strictObject({
  subject,
  role: z.enum(['admin', 'member']),
  status: z.enum(['active', 'suspended']),
});
export const createTeamSchema = z.strictObject({
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,5}$/),
  name: z.string().trim().min(1).max(200),
  emoji: z.string().max(32).refine(isValidEmoji, 'Expected a Unicode emoji').optional(),
  private: z.boolean().optional(),
  start_number: z.number().int().min(1).max(2147483646).optional(),
});
export const updateTeamSchema = createTeamSchema.pick({ name: true, emoji: true, private: true })
  .partial();
export const changeTeamMemberSchema = z.strictObject({
  subject,
  role: z.enum(['owner', 'member']).optional(),
  remove: z.boolean().optional(),
});
export const joinTeamSchema = z.strictObject({
  leave: z.boolean().optional(),
  confirm_private: z.boolean().optional(),
});
export const createIssueSchema = z.strictObject({
  project_id: z.number().int().min(0).max(2147483647).optional(),
  project: z.string().max(200).optional(),
  cycle_id: z.number().int().min(0).max(2147483647).optional(),
  parent: z.string().max(100).optional(),
  team: z.string().min(1).max(6),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(100000).optional(),
  status: status.optional(),
  type: type.nullable().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  assignee: subject.nullable().optional(),
});
export const updateIssueSchema = createIssueSchema.omit({ team: true }).partial();
export const listIssuesSchema = z.strictObject({
  spec: z.string().regex(/^SPEC-[1-9][0-9]*$/).optional(),
  project_id: z.number().int().min(0).max(2147483647).optional(),
  project: z.string().max(200).optional(),
  cycle_id: z.number().int().min(0).max(2147483647).optional(),
  parent: z.string().max(100).optional(),
  label_mode: z.enum(['any', 'all', 'none', 'unlabeled']).optional(),
  label_ids: z.array(z.number().int().positive()).optional(),
  label_group_ids: z.array(z.number().int().positive()).optional(),
  sort: z.enum(['created', 'updated', 'priority']).optional(),
  type: z.union([type, z.literal('')]).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  assignee: subject.nullable().optional(),
  assigned_to_me: z.boolean().optional(),
  team: z.string().optional(),
  status: status.optional(),
  query: z.string().max(500).optional(),
  limit: z.number().int().min(-2147483648).max(2147483647).optional(),
  cursor: z.string().uuid().optional(),
});
