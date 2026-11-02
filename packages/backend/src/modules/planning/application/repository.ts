import type { Row } from '../../../application/records.ts';
export interface PlanningRepository {
  findProject(
    input: {
      workspaceId: string;
      byId: boolean;
      id: number | undefined;
      name: undefined | string;
      subject: string;
    },
  ): Promise<Row[]>;
  projectTeamKeys(
    input: { recordId: unknown; workspaceId: unknown; subject: string },
  ): Promise<Row[]>;
  projectTeams(input: { subject: string; projectId: number }): Promise<Row[]>;
  usedProjectTeams(input: { workspaceId: unknown; projectId: number }): Promise<Row[]>;
  removeProjectTeam(input: { projectId: number; teamId: unknown }): Promise<void>;
  addProjectTeam(input: { workspaceId: unknown; projectId: number; id: string }): Promise<void>;
  initiativeProjectIds(
    input: { recordId: unknown; workspaceId: unknown; subject: string },
  ): Promise<Row[]>;
  findInitiativeProject(input: { id: number; project: number }): Promise<Row[]>;
  visibleInitiativeProjects(
    input: { id: number; workspaceId: unknown; subject: string },
  ): Promise<Row[]>;
  removeInitiativeProject(input: { initiativeId: number; projectId: unknown }): Promise<void>;
  addInitiativeProject(input: { workspaceId: unknown; id: number; project: number }): Promise<void>;
  projectTeamExists(input: { workspaceId: string; id: unknown; teamId: string }): Promise<Row[]>;
  listProjects(
    input: {
      workspaceId: unknown;
      subject: string;
      include_archived: boolean;
      hasTeam: boolean;
      team: string | undefined;
    },
  ): Promise<Row[]>;
  insertProject(
    input: {
      workspaceId: unknown;
      name: string;
      description: string;
      emoji: string;
      start_date: null | string;
      target_date: null | string;
    },
  ): Promise<Row>;
  updateProject(
    input: {
      new_name: unknown;
      description: unknown;
      emoji: unknown;
      archived: unknown;
      start: unknown;
      target: unknown;
      workspaceId: unknown;
      id: unknown;
    },
  ): Promise<Row>;
  listInitiatives(input: { workspaceId: unknown; include_archived: boolean }): Promise<Row[]>;
  findInitiative(input: { workspaceId: unknown; id: number }): Promise<Row>;
  insertInitiative(
    input: { workspaceId: unknown; name: string; description: string },
  ): Promise<Row>;
  loadInitiative(input: { workspaceId: unknown; id: number }): Promise<Row>;
  updateInitiative(
    input: {
      name: unknown;
      description: unknown;
      archived: boolean;
      workspaceId: unknown;
      id: number;
    },
  ): Promise<Row>;
}
