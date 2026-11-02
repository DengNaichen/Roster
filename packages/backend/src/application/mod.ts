import type {
  ChangeTeamMemberInput,
  CreateIssueInput,
  CreateTeamInput,
  Identity,
  Issue,
  IssueDetail,
  IssuePage,
  JoinTeamInput,
  ListIssuesInput,
  Member,
  RequestContext,
  Team,
  TeamMember,
  UpdateIssueInput,
  UpdateMemberInput,
  UpdateTeamInput,
  Workspace,
} from '../../../contracts/mod.ts';
import type { ActivityService } from './activity.ts';
import type { CatalogService } from './catalog.ts';
import type { CycleService } from './cycles.ts';
import type { SpecService } from './spec.ts';
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
