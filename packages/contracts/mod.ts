import type { SpecService } from './spec.ts';
import type { CatalogService, Label } from './catalog.ts';
import type { CycleService } from './cycles.ts';
import type { ActivityIssueDetails, ActivityService } from './activity.ts';
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
  description: string;
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
  description?: string;
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
export interface Service extends CatalogService, CycleService, ActivityService, SpecService {
  listWorkspaces(ctx: RequestContext): Promise<Workspace[]>;
  createWorkspace(
    ctx: RequestContext,
    input: { slug: string; name: string },
  ): Promise<Workspace>;
  updateWorkspace(
    ctx: RequestContext,
    slug: string,
    input: { name: string },
  ): Promise<Workspace>;
  listMembers(ctx: RequestContext, slug: string): Promise<Member[]>;
  updateMember(
    ctx: RequestContext,
    slug: string,
    input: UpdateMemberInput,
  ): Promise<void>;
  resetInvite(ctx: RequestContext, slug: string): Promise<{ token: string }>;
  joinWorkspace(
    ctx: RequestContext,
    input: { token: string },
  ): Promise<Workspace>;
  listTeams(ctx: RequestContext, slug: string): Promise<Team[]>;
  teamDirectory(ctx: RequestContext, slug: string): Promise<Team[]>;
  createTeam(
    ctx: RequestContext,
    slug: string,
    input: CreateTeamInput,
  ): Promise<Team>;
  updateTeam(
    ctx: RequestContext,
    slug: string,
    key: string,
    input: UpdateTeamInput,
  ): Promise<Team>;
  listAssignees(ctx: RequestContext, slug: string, key: string): Promise<Identity[]>;
  listTeamMembers(
    ctx: RequestContext,
    slug: string,
    key: string,
  ): Promise<TeamMember[]>;
  changeTeamMember(
    ctx: RequestContext,
    slug: string,
    key: string,
    input: ChangeTeamMemberInput,
  ): Promise<void>;
  joinTeam(
    ctx: RequestContext,
    slug: string,
    key: string,
    input: JoinTeamInput,
  ): Promise<Team>;
  listIssues(
    ctx: RequestContext,
    slug: string,
    input?: ListIssuesInput,
  ): Promise<IssuePage>;
  getIssue(
    ctx: RequestContext,
    slug: string,
    identifier: string,
  ): Promise<IssueDetail>;
  createIssue(
    ctx: RequestContext,
    slug: string,
    input: CreateIssueInput,
  ): Promise<Issue>;
  updateIssue(
    ctx: RequestContext,
    slug: string,
    identifier: string,
    input: UpdateIssueInput,
  ): Promise<Issue>;
}
export * from './schemas.ts';

export * from './catalog.ts';
export * from './cycles.ts';
export * from './activity.ts';

export * from './spec.ts';
