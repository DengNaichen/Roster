import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one, rows } from '../../../platform/database/query.ts';
import { visible } from '../../access/postgres.ts';
import type { PlanningRepository } from '../application/repository.ts';
import { projectColumns, visibleProject } from '../postgres.ts';

export function createPlanningRepository(db: Executor): PlanningRepository {
  return {
    async findProject({ workspaceId, byId, id, name, subject }) {
      return rows(
        db,
        sql`select ${projectColumns} from roster.projects p where p.workspace_id=${workspaceId} and ${
          byId ? sql`p.id=${id}` : sql`p.name=${name}`
        } and ${visibleProject(subject)}`,
      );
    },
    async projectTeamKeys({ recordId, workspaceId, subject }) {
      return rows(
        db,
        sql`select t.key from roster.project_teams pt join roster.teams t on t.id=pt.team_id where pt.project_id=${recordId} and t.workspace_id=${workspaceId} and ${
          visible(subject)
        } order by t.key`,
      );
    },
    async projectTeams({ subject, projectId }) {
      return rows(
        db,
        sql`select t.id,${
          visible(subject)
        } as visible from roster.project_teams pt join roster.teams t on t.id=pt.team_id where pt.project_id=${projectId}`,
      );
    },
    async usedProjectTeams({ workspaceId, projectId }) {
      return rows(
        db,
        sql`select distinct team_id from roster.issues where workspace_id=${workspaceId} and project_id=${projectId}`,
      );
    },
    async removeProjectTeam({ projectId, teamId }) {
      await db.execute(
        sql`delete from roster.project_teams where project_id=${projectId} and team_id=${teamId}`,
      );
    },
    async addProjectTeam({ workspaceId, projectId, id }) {
      await db.execute(
        sql`insert into roster.project_teams(workspace_id,project_id,team_id) values(${workspaceId},${projectId},${id}) on conflict do nothing`,
      );
    },
    async initiativeProjectIds({ recordId, workspaceId, subject }) {
      return rows(
        db,
        sql`select p.id from roster.initiative_projects ip join roster.projects p on p.id=ip.project_id where ip.initiative_id=${recordId} and p.workspace_id=${workspaceId} and ${
          visibleProject(subject)
        } order by p.id`,
      );
    },
    async findInitiativeProject({ id, project }) {
      return rows(
        db,
        sql`select 1 from roster.initiative_projects where initiative_id=${id} and project_id=${project}`,
      );
    },
    async visibleInitiativeProjects({ id, workspaceId, subject }) {
      return rows(
        db,
        sql`select p.id from roster.initiative_projects ip join roster.projects p on p.id=ip.project_id where ip.initiative_id=${id} and p.workspace_id=${workspaceId} and ${
          visibleProject(subject)
        }`,
      );
    },
    async removeInitiativeProject({ initiativeId, projectId }) {
      await db.execute(
        sql`delete from roster.initiative_projects where initiative_id=${initiativeId} and project_id=${projectId}`,
      );
    },
    async addInitiativeProject({ workspaceId, id, project }) {
      await db.execute(
        sql`insert into roster.initiative_projects(workspace_id,initiative_id,project_id) values(${workspaceId},${id},${project}) on conflict do nothing`,
      );
    },
    async projectTeamExists({ workspaceId, id, teamId }) {
      return rows(
        db,
        sql`select 1 from roster.project_teams where workspace_id=${workspaceId} and project_id=${id} and team_id=${teamId}`,
      );
    },
    async listProjects({ workspaceId, subject, include_archived, hasTeam, team }) {
      return rows(
        db,
        sql`select ${projectColumns} from roster.projects p where p.workspace_id=${workspaceId} and ${
          visibleProject(subject)
        } and (${include_archived} or not p.archived) ${
          hasTeam
            ? sql`and exists(select 1 from roster.project_teams pt join roster.teams ft on ft.id=pt.team_id where pt.project_id=p.id and ft.key=${team})`
            : sql``
        } order by p.name`,
      );
    },
    async insertProject({ workspaceId, name, description, emoji, start_date, target_date }) {
      return one(
        db,
        sql`insert into roster.projects(workspace_id,name,description,emoji,start_date,target_date) values(${workspaceId},${name},${description},${emoji},${start_date},${target_date}) returning *,start_date::text as start_date,target_date::text as target_date`,
      );
    },
    async updateProject(
      { new_name, description, emoji, archived, start, target, workspaceId, id },
    ) {
      return one(
        db,
        sql`update roster.projects set name=${new_name},description=${description},emoji=${emoji},archived=${archived},start_date=${start},target_date=${target} where workspace_id=${workspaceId} and id=${id} returning *,start_date::text as start_date,target_date::text as target_date`,
      );
    },
    async listInitiatives({ workspaceId, include_archived }) {
      return rows(
        db,
        sql`select * from roster.initiatives where workspace_id=${workspaceId} and (${include_archived} or not archived) order by name,id`,
      );
    },
    async findInitiative({ workspaceId, id }) {
      return one(
        db,
        sql`select * from roster.initiatives where workspace_id=${workspaceId} and id=${id}`,
      );
    },
    async insertInitiative({ workspaceId, name, description }) {
      return one(
        db,
        sql`insert into roster.initiatives(workspace_id,name,description) values(${workspaceId},${name},${description}) returning *`,
      );
    },
    async loadInitiative({ workspaceId, id }) {
      return one(
        db,
        sql`select * from roster.initiatives where workspace_id=${workspaceId} and id=${id}`,
      );
    },
    async updateInitiative({ name, description, archived, workspaceId, id }) {
      return one(
        db,
        sql`update roster.initiatives set name=${name},description=${description},archived=${archived} where workspace_id=${workspaceId} and id=${id} returning *`,
      );
    },
  };
}
