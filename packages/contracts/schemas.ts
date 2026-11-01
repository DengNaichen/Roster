import { z } from 'zod';
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
  emoji: z.string().max(32).optional(),
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
  type: z.union([type, z.literal('')]).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  assignee: subject.nullable().optional(),
  assigned_to_me: z.boolean().optional(),
  team: z.string().optional(),
  status: status.optional(),
  query: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().uuid().optional(),
});
