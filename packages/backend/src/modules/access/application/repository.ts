import type { Row } from '../../../application/records.ts';
export interface AccessRepository {
  ensureGitHubIdentity(): Promise<void>;

  nextIssueNumber(teamId: string): Promise<number>;

  saveIdentity(input: { subject: string; name: string; email: string }): Promise<void>;
  findWorkspace(input: { slug: string; lock: boolean }): Promise<Row>;
  activeMembership(input: { workspaceId: unknown; subject: string }): Promise<Row[]>;
  findTeam(input: { subject: string; workspaceId: unknown; key: string }): Promise<Row>;
  listWorkspaces(input: { subject: string }): Promise<Row[]>;
  insertWorkspace(input: { slug: string; name: string }): Promise<Row>;
  insertAdministrator(input: { workspaceId: unknown; subject: string }): Promise<void>;
  renameWorkspace(input: { name: string; workspaceId: unknown }): Promise<Row>;
  listMembers(input: { workspaceId: unknown }): Promise<Row[]>;
  findMember(input: { workspaceId: unknown; subject: string }): Promise<Row>;
  countAdministrators(input: { workspaceId: unknown }): Promise<Row>;
  updateMember(
    input: { role: string; status: string; workspaceId: unknown; subject: string },
  ): Promise<void>;
  saveInvite(input: { workspaceId: unknown; digest: string }): Promise<void>;
  lockInvitedWorkspace(input: { token: string }): Promise<Row>;
  findInvite(input: { workspaceId: unknown; token: string }): Promise<Row[]>;
  findMembership(input: { workspaceId: unknown; subject: string }): Promise<Row[]>;
  joinWorkspace(input: { workspaceId: unknown; subject: string }): Promise<void>;
  listTeams(input: { subject: string; workspaceId: unknown; isAdmin: boolean }): Promise<Row[]>;
  insertTeam(
    input: {
      workspaceId: unknown;
      key: string;
      name: string;
      emoji: string;
      isPrivate: boolean;
      start_number: number;
    },
  ): Promise<Row>;
  insertOwner(input: { workspaceId: unknown; teamId: unknown; subject: string }): Promise<void>;
  updateTeam(
    input: { name: unknown; emoji: unknown; isPrivate: unknown; teamId: unknown },
  ): Promise<Row>;
  ensureOwner(input: { workspaceId: unknown; teamId: unknown; subject: string }): Promise<void>;
  listAssignees(
    input: { workspaceId: unknown; publicTeam: boolean; teamId: unknown },
  ): Promise<Row[]>;
  listTeamMembers(input: { teamId: unknown }): Promise<Row[]>;
  requireActiveMember(input: { workspaceId: unknown; subject: string }): Promise<Row>;
  removeTeamMember(input: { teamId: unknown; subject: string }): Promise<void>;
  saveTeamMember(
    input: { workspaceId: unknown; teamId: unknown; subject: string; role: undefined | string },
  ): Promise<void>;
  leaveTeam(input: { teamId: unknown; subject: string }): Promise<void>;
  joinTeam(input: { workspaceId: unknown; teamId: unknown; subject: string }): Promise<void>;
  lockWorkspace(input: { workspace_id: unknown }): Promise<Row>;
}
