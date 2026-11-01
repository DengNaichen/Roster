/** REST-only compatibility for the original InfTask UI. MCP keeps its native contracts. */
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
  assignees: true,
  assignments: true,
  projects: false,
  initiatives: false,
  labels: false,
  cycles: false,
  comments: false,
  work_logs: false,
  delegations: false,
  relations: false,
  links: false,
  pull_requests: false,
} as const;
export class UnsupportedFeatureError extends Error {
  constructor(public feature: string) {
    super(`${feature} has not been migrated`);
  }
}
const legacyRelations = {
  project_id: z.union([z.number().int(), z.string()]).optional(),
  project: z.string().optional(),
  parent: z.string().optional(),
  cycle_id: z.union([z.number().int(), z.string()]).optional(),
};
const assignee = z.union([z.string().uuid(), z.literal(''), z.null()]).optional();
const type = z.union([createIssueSchema.shape.type, z.literal('')]);
function normalize(input: Record<string, unknown>) {
  for (
    const [key, feature] of [['project_id', 'projects'], ['project', 'projects'], [
      'parent',
      'relations',
    ], ['cycle_id', 'cycles']] as const
  ) {
    if (input[key] !== undefined && input[key] !== 0 && input[key] !== '') {
      throw new UnsupportedFeatureError(feature);
    }
    delete input[key];
  }
  if (input.assignee === '') input.assignee = null;
  if (input.type === '') input.type = null;
  return input;
}
export const restCreateIssueSchema = createIssueSchema.extend({
  ...legacyRelations,
  assignee,
  type,
}).transform((v) => createIssueSchema.parse(normalize(v)));
export const restUpdateIssueSchema = updateIssueSchema.extend({
  ...legacyRelations,
  assignee,
  type,
}).transform((v) => updateIssueSchema.parse(normalize(v)));
export function restListInput(query: Record<string, string>) {
  const q: Record<string, unknown> = { ...query };
  if (q.search !== undefined) {
    q.query = q.search;
    delete q.search;
  }
  for (const key of ['limit', 'priority']) if (q[key] !== undefined) q[key] = Number(q[key]);
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
  if (q.label_mode !== undefined) {
    if (q.label_mode !== 'any') throw new UnsupportedFeatureError('labels');
    delete q.label_mode;
  }
  for (const key of ['label_id', 'label_group_id', 'project_id', 'project', 'cycle_id', 'parent']) {
    if (q[key] !== undefined) {
      throw new UnsupportedFeatureError(
        key.startsWith('label')
          ? 'labels'
          : key.startsWith('project')
          ? 'projects'
          : key === 'cycle_id'
          ? 'cycles'
          : 'relations',
      );
    }
  }
  return listIssuesSchema.parse(q);
}
export function restTeam(team: Team) {
  return { ...team, membership_enabled: true };
}
export function restIssue(issue: Issue) {
  return {
    ...issue,
    project: null,
    project_id: null,
    project_emoji: '',
    parent: null,
    cycle_id: null,
  };
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
export function unsupportedRoute(path: string): string | undefined {
  if (/\/(projects|initiatives|labels|label-groups)(\/|$)/.test(path)) {
    return path.match(/\/(projects|initiatives|labels|label-groups)(\/|$)/)![1];
  }
  if (/\/cycles(\/|$)/.test(path)) return 'cycles';
  if (/\/comments(\/|$)/.test(path)) return 'comments';
  if (/\/work-logs(\/|$)/.test(path)) return 'work_logs';
  if (/\/(delegations|delegate)(\/|$)/.test(path)) return 'delegations';
  if (/\/(relations|links|pull-requests)(\/|$)/.test(path)) {
    return path.match(/\/(relations|links|pull-requests)(\/|$)/)![1];
  }
}
