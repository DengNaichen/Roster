/** Preserve original InfTask input clearing, filters and REST envelope fields. */
import { z } from 'npm:zod@4.6.7';
import {
  createIssueSchema,
  type Issue,
  type IssueDetail,
  listIssuesSchema,
  type Member,
  type Team,
  updateIssueSchema,
} from '../../../contracts/mod.ts';
export const capabilities = {
  workspaces: true,
  members: true,
  teams: true,
  issues: true,
  specs: true,
  assignees: true,
  assignments: true,
  projects: true,
  initiatives: true,
  labels: true,
  cycles: true,
  comments: true,
  work_logs: true,
  delegations: true,
  relations: true,
  links: true,
  pull_requests: true,
} as const;
const assignee = z.union([z.string().uuid(), z.literal(''), z.null()]).optional();
const type = z.union([createIssueSchema.shape.type, z.literal('')]);
function normalize(input: Record<string, unknown>) {
  if (input.assignee === '') input.assignee = null;
  if (input.type === '') input.type = null;
  return input;
}
export const restCreateIssueSchema = createIssueSchema.extend({ assignee, type }).transform((v) =>
  createIssueSchema.parse(normalize(v))
);
export const restUpdateIssueSchema = updateIssueSchema.extend({ assignee, type }).transform((v) =>
  updateIssueSchema.parse(normalize(v))
);
export function restListInput(query: Record<string, string | string[]>) {
  const q: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (
      Array.isArray(value) &&
      !['label_id', 'label_group_id', 'label_ids', 'label_group_ids'].includes(key)
    ) {
      if (value.length !== 1) {
        throw new z.ZodError([{
          code: 'custom',
          path: [key],
          message: 'Repeated scalar query parameter',
        }]);
      }
      q[key] = value[0];
    } else q[key] = value;
  }

  if (q.search !== undefined) {
    q.query = q.search;
    delete q.search;
  }
  for (const key of ['limit', 'priority', 'project_id', 'cycle_id']) {
    if (q[key] !== undefined) q[key] = Number(q[key]);
  }
  for (
    const [singular, plural] of [['label_id', 'label_ids'], ['label_group_id', 'label_group_ids']]
  ) {
    if (q[singular] !== undefined) {
      const values = Array.isArray(q[singular]) ? q[singular] as string[] : [String(q[singular])];
      q[plural] = values.flatMap((v) => v.split(',')).map(Number);
      delete q[singular];
    }
    if (q[plural] !== undefined) {
      const values = Array.isArray(q[plural]) ? q[plural] as string[] : [String(q[plural])];
      q[plural] = values.flatMap((v) => String(v).split(',')).filter(Boolean).map(Number);
    }
  }
  if (q.assigned_to_me !== undefined) {
    if (q.assigned_to_me !== 'true' && q.assigned_to_me !== 'false') {
      throw new z.ZodError([{
        code: 'custom',
        path: ['assigned_to_me'],
        message: 'Expected true or false',
      }]);
    }
    q.assigned_to_me = q.assigned_to_me === 'true';
  }
  if (q.assignee === '') q.assignee = null;
  return listIssuesSchema.parse(q);
}
export function restTeam(team: Team) {
  return { ...team, membership_enabled: true };
}
export function restIssue(issue: Issue) {
  return { ...issue };
}
export function restDetail(issue: IssueDetail, members: Member[]) {
  const person = (subject: unknown) => members.find((m) => m.subject === subject) ?? null;
  const assignments = issue.audit.flatMap((event) => {
    const before = event.before as { assignee_subject?: string | null } | null;
    const after = event.after as { assignee_subject?: string | null } | null;
    if (
      !['issue.created', 'issue.updated'].includes(event.kind) ||
      (before?.assignee_subject ?? null) === (after?.assignee_subject ?? null)
    ) return [];
    return [{
      actor: person(event.actor_subject),
      from: person(before?.assignee_subject),
      to: person(after?.assignee_subject),
      created_at: event.created_at,
    }];
  });
  return { ...restIssue(issue), audit: issue.audit, assignments };
}
