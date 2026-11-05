import type { IssueDocument } from './issue-document.ts';
import type { Label } from './catalog.ts';

import type { ActivityIssueDetails } from './activity.ts';
export type Identity = { subject: string; name: string; email: string };
export type RequestContext = { identity: Identity };
export const statuses = [
  'triage',
  'backlog',
  'todo',
  'agent_ready',
  'in_progress',
  'in_review',
  'done',
  'canceled',
] as const;
export type IssueStatus = typeof statuses[number];
export const issueTypes = [
  'spec',
  'feature',
  'bug',
  'improvement',
  'chore',
] as const;
export type IssueType = typeof issueTypes[number];
export type Workspace = {
  id: string;
  slug: string;
  name: string;
  role: 'admin' | 'member';
};
export type Member = Identity & {
  role: 'admin' | 'member';
  status: 'active' | 'suspended';
};
export type TeamMember = Identity & {
  workspace_admin: boolean;
  role: 'owner' | 'member';
  status: 'active' | 'suspended';
};
export type Team = {
  id: string;
  key: string;
  name: string;
  emoji: string;
  private: boolean;
  joined: boolean;
  accessible: boolean;
  can_manage: boolean;
  next_number: number | null;
};
export type Issue = {
  id: string;
  identifier: string;
  team: string;
  title: string;
  document: IssueDocument;
  status: IssueStatus;
  type: IssueType | null;
  priority: number;
  assignee: Identity | null;
  project_id: number | null;
  project: string | null;
  project_emoji: string;
  cycle_id: number | null;
  parent: string | null;
  labels: Label[];
  created_at: string;
  updated_at: string;
};
export type AuditEvent = {
  id: string;
  kind: string;
  actor_subject: string;
  before: unknown;
  after: unknown;
  created_at: string;
};
export type IssueDetail = Issue & { audit: AuditEvent[]; children: Issue[] } & ActivityIssueDetails;
export type CreateIssueInput = {
  team: string;
  title: string;
  document?: IssueDocument;
  status?: IssueStatus;
  type?: IssueType | null;
  priority?: number;
  assignee?: string | null;
  project_id?: number;
  project?: string;
  cycle_id?: number;
  parent?: string;
};
export type UpdateIssueInput = Partial<Omit<CreateIssueInput, 'team'>>;
export type ListIssuesInput = {
  spec?: string;
  team?: string;
  status?: IssueStatus;
  type?: IssueType | '';
  priority?: number;
  assignee?: string | null;
  assigned_to_me?: boolean;
  project_id?: number;
  project?: string;
  cycle_id?: number;
  parent?: string;
  label_ids?: number[];
  label_group_ids?: number[];
  label_mode?: 'any' | 'all' | 'none' | 'unlabeled';
  sort?: 'created' | 'updated' | 'priority';
  query?: string;
  limit?: number;
  /** Last issue UUID in this query. Default order is updated DESC; agent_ready defaults to priority (0 last). Zero limit defaults to 50, negative returns all. */
  cursor?: string;
};
export type IssuePage = { items: Issue[]; next_cursor: string | null };
export type CreateTeamInput = {
  key: string;
  name: string;
  emoji?: string;
  private?: boolean;
  start_number?: number;
};
export type UpdateTeamInput = {
  name?: string;
  emoji?: string;
  private?: boolean;
};
export type UpdateMemberInput = {
  subject: string;
  role: 'admin' | 'member';
  status: 'active' | 'suspended';
};
export type ChangeTeamMemberInput = {
  subject: string;
  role?: 'owner' | 'member';
  remove?: boolean;
};
export type JoinTeamInput = { leave?: boolean; confirm_private?: boolean };
export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'conflict';
export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export * from './schemas.ts';

export * from './activity.ts';
export * from './catalog.ts';
export * from './cycles.ts';

export * from './spec.ts';
export * from './issue-document.ts';
