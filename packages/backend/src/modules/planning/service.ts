import { type SQL, sql } from 'npm:drizzle-orm@0.45.4';
import type { Initiative, Project } from '../../../../contracts/catalog.ts';
import * as schemas from '../../../../contracts/catalog.ts';
import { type RequestContext } from '../../../../contracts/mod.ts';
import type { CatalogService } from '../../application/catalog.ts';
import type { Database } from '../../platform/database/client.ts';
import { type Executor, one, type Row, rows } from '../../platform/database/query.ts';
import { fail } from '../../platform/errors/validation.ts';
import { team, visible, workspace } from '../access/index.ts';

import { translate } from '../../platform/database/catalog-errors.ts';
import { parse } from '../../platform/errors/parse.ts';
export function visibleProject(subject: string): SQL {
  return sql`(not exists(select 1 from roster.project_teams pt where pt.project_id=p.id) or exists(select 1 from roster.project_teams pt join roster.teams t on t.id=pt.team_id where pt.project_id=p.id and ${
    visible(subject)
  }))`;
}
const projectColumns = sql`p.*,p.start_date::text as start_date,p.target_date::text as target_date`;
function projectDTO(row: Row, teams: string[]): Project {
  return {
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description),
    emoji: String(row.emoji),
    archived: Boolean(row.archived),
    teams,
    ...(row.start_date ? { start_date: String(row.start_date) } : {}),
    ...(row.target_date ? { target_date: String(row.target_date) } : {}),
  };
}
async function projectRow(
  db: Executor,
  ctx: RequestContext,
  workspaceId: string,
  ref: { id?: number; name?: string },
): Promise<Row> {
  const row = (await rows(
    db,
    sql`select ${projectColumns} from roster.projects p where p.workspace_id=${workspaceId} and ${
      ref.id ? sql`p.id=${ref.id}` : sql`p.name=${ref.name}`
    } and ${visibleProject(ctx.identity.subject)}`,
  ))[0];
  if (!row) fail('not_found', 'Project not found');
  if (ref.name && row.name !== ref.name) {
    fail('invalid_input', 'Project id and name must refer to the same project');
  }
  return row;
}
async function projectOutput(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  row: Row,
): Promise<Project> {
  const ts = await rows(
    db,
    sql`select t.key from roster.project_teams pt join roster.teams t on t.id=pt.team_id where pt.project_id=${row.id} and t.workspace_id=${w.id} and ${
      visible(ctx.identity.subject)
    } order by t.key`,
  );
  return projectDTO(row, ts.map((t) => String(t.key)));
}
function validateDates(start: unknown, target: unknown) {
  if (start && target && String(start) > String(target)) {
    fail('invalid_input', 'Project start date must not follow target date');
  }
}
async function replaceProjectTeams(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  projectId: number,
  keys: string[],
) {
  if (keys.length === 0) fail('invalid_input', 'A project requires at least one team');
  const selected = new Set<string>();
  for (const key of new Set(keys)) selected.add(String((await team(db, ctx, w, key)).id));
  const current = await rows(
    db,
    sql`select t.id,${
      visible(ctx.identity.subject)
    } as visible from roster.project_teams pt join roster.teams t on t.id=pt.team_id where pt.project_id=${projectId}`,
  );
  for (const t of current) if (!t.visible) selected.add(String(t.id));
  const used = await rows(
    db,
    sql`select distinct team_id from roster.issues where workspace_id=${w.id} and project_id=${projectId}`,
  );
  if (used.some((row) => !selected.has(String(row.team_id)))) {
    fail('conflict', 'Cannot remove a project team that still has issues');
  }
  for (const t of current) {
    if (!selected.has(String(t.id))) {
      await db.execute(
        sql`delete from roster.project_teams where project_id=${projectId} and team_id=${t.id}`,
      );
    }
  }
  for (const id of selected) {
    await db.execute(
      sql`insert into roster.project_teams(workspace_id,project_id,team_id) values(${w.id},${projectId},${id}) on conflict do nothing`,
    );
  }
}
async function initiativeOutput(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  row: Row,
): Promise<Initiative> {
  const ps = await rows(
    db,
    sql`select p.id from roster.initiative_projects ip join roster.projects p on p.id=ip.project_id where ip.initiative_id=${row.id} and p.workspace_id=${w.id} and ${
      visibleProject(ctx.identity.subject)
    } order by p.id`,
  );
  return {
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description),
    archived: Boolean(row.archived),
    project_ids: ps.map((p) => Number(p.id)),
  };
}
async function replaceInitiativeProjects(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  id: number,
  archived: boolean,
  projects: number[],
) {
  const selected = new Set(projects);
  for (const project of selected) {
    const p = await projectRow(db, ctx, String(w.id), { id: project });
    const linked = (await rows(
      db,
      sql`select 1 from roster.initiative_projects where initiative_id=${id} and project_id=${project}`,
    )).length > 0;
    if (!linked && (archived || p.archived)) {
      fail('conflict', 'Archived initiatives or projects cannot accept new associations');
    }
  }
  const existing = await rows(
    db,
    sql`select p.id from roster.initiative_projects ip join roster.projects p on p.id=ip.project_id where ip.initiative_id=${id} and p.workspace_id=${w.id} and ${
      visibleProject(ctx.identity.subject)
    }`,
  );
  for (const p of existing) {
    if (!selected.has(Number(p.id))) {
      await db.execute(
        sql`delete from roster.initiative_projects where initiative_id=${id} and project_id=${p.id}`,
      );
    }
  }
  for (const project of selected) {
    await db.execute(
      sql`insert into roster.initiative_projects(workspace_id,initiative_id,project_id) values(${w.id},${id},${project}) on conflict do nothing`,
    );
  }
}
/** Resolve an issue reference in its existing transaction; omitted means retain. */
export async function resolveIssueProject(
  db: Executor,
  ctx: RequestContext,
  workspaceId: string,
  teamId: string,
  input: { project_id?: number; project?: string },
  currentId: number | null,
): Promise<number | null> {
  if (input.project_id === undefined && input.project === undefined) return currentId;
  if (
    input.project_id !== undefined &&
    (!Number.isSafeInteger(input.project_id) || input.project_id < 0)
  ) fail('invalid_input', 'Invalid project id');
  if (input.project !== undefined && typeof input.project !== 'string') {
    fail('invalid_input', 'Invalid project name');
  }
  if (input.project_id === 0 || input.project === '') {
    if (
      (input.project_id === 0 && input.project !== undefined && input.project !== '') ||
      (input.project === '' && input.project_id !== undefined && input.project_id !== 0)
    ) fail('invalid_input', 'Project references do not match');
    return null;
  }
  const p = await projectRow(db, ctx, workspaceId, { id: input.project_id, name: input.project });
  const compatible = (await rows(
    db,
    sql`select 1 from roster.project_teams where workspace_id=${workspaceId} and project_id=${p.id} and team_id=${teamId}`,
  )).length > 0;
  if (!compatible) fail('invalid_input', 'The project is not associated with this team');
  if (p.archived && Number(p.id) !== currentId) {
    fail('conflict', 'Archived projects cannot accept new issues');
  }
  return Number(p.id);
}

export function createPlanningService(
  db: Database,
): Pick<
  CatalogService,
  | 'listProjects'
  | 'getProject'
  | 'createProject'
  | 'updateProject'
  | 'listInitiatives'
  | 'getInitiative'
  | 'createInitiative'
  | 'updateInitiative'
> {
  return {
    async listProjects(ctx, slug, input = {}) {
      const q = parse(schemas.listProjectsSchema, input);
      const w = await workspace(db, ctx, slug);
      if (q.team) await team(db, ctx, w, q.team);
      const ps = await rows(
        db,
        sql`select ${projectColumns} from roster.projects p where p.workspace_id=${w.id} and ${
          visibleProject(ctx.identity.subject)
        } and (${q.include_archived ?? false} or not p.archived) ${
          q.team
            ? sql`and exists(select 1 from roster.project_teams pt join roster.teams ft on ft.id=pt.team_id where pt.project_id=p.id and ft.key=${q.team})`
            : sql``
        } order by p.name`,
      );
      return await Promise.all(ps.map((p) => projectOutput(db, ctx, w, p)));
    },
    async getProject(ctx, slug, input) {
      const q = parse(schemas.getProjectSchema, input);
      const w = await workspace(db, ctx, slug);
      return await projectOutput(db, ctx, w, await projectRow(db, ctx, String(w.id), q));
    },
    async createProject(ctx, slug, input) {
      const q = parse(schemas.createProjectSchema, input);
      validateDates(q.start_date, q.target_date);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const p = await one(
            tx,
            sql`insert into roster.projects(workspace_id,name,description,emoji,start_date,target_date) values(${w.id},${q.name},${
              q.description ?? ''
            },${q.emoji ?? ''},${q.start_date || null},${
              q.target_date || null
            }) returning *,start_date::text as start_date,target_date::text as target_date`,
          );
          await replaceProjectTeams(tx, ctx, w, Number(p.id), q.teams);
          return await projectOutput(tx, ctx, w, p);
        })
      );
    },
    async updateProject(ctx, slug, input) {
      const q = parse(schemas.updateProjectSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const current = await projectRow(tx, ctx, String(w.id), q);
          const start = q.start_date === undefined ? current.start_date : q.start_date || null;
          const target = q.target_date === undefined ? current.target_date : q.target_date || null;
          validateDates(start, target);
          if (q.teams !== undefined) {
            await replaceProjectTeams(tx, ctx, w, Number(current.id), q.teams);
          }
          const p = await one(
            tx,
            sql`update roster.projects set name=${q.new_name ?? current.name},description=${
              q.description ?? current.description
            },emoji=${q.emoji ?? current.emoji},archived=${
              q.archived ?? current.archived
            },start_date=${start},target_date=${target} where workspace_id=${w.id} and id=${current.id} returning *,start_date::text as start_date,target_date::text as target_date`,
          );
          return await projectOutput(tx, ctx, w, p);
        })
      );
    },
    async listInitiatives(ctx, slug, input = {}) {
      const q = parse(schemas.listInitiativesSchema, input);
      const w = await workspace(db, ctx, slug);
      const entries = await rows(
        db,
        sql`select * from roster.initiatives where workspace_id=${w.id} and (${
          q.include_archived ?? false
        } or not archived) order by name,id`,
      );
      return await Promise.all(entries.map((row) => initiativeOutput(db, ctx, w, row)));
    },
    async getInitiative(ctx, slug, input) {
      const q = parse(schemas.getInitiativeSchema, input);
      const w = await workspace(db, ctx, slug);
      const row = await one(
        db,
        sql`select * from roster.initiatives where workspace_id=${w.id} and id=${q.id}`,
      );
      return await initiativeOutput(db, ctx, w, row);
    },
    async createInitiative(ctx, slug, input) {
      const q = parse(schemas.createInitiativeSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const row = await one(
            tx,
            sql`insert into roster.initiatives(workspace_id,name,description) values(${w.id},${q.name},${
              q.description ?? ''
            }) returning *`,
          );
          await replaceInitiativeProjects(tx, ctx, w, Number(row.id), false, q.project_ids ?? []);
          return await initiativeOutput(tx, ctx, w, row);
        })
      );
    },
    async updateInitiative(ctx, slug, input) {
      const q = parse(schemas.updateInitiativeSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const current = await one(
            tx,
            sql`select * from roster.initiatives where workspace_id=${w.id} and id=${q.id}`,
          );
          const archived = q.archived ?? Boolean(current.archived);
          if (q.project_ids !== undefined) {
            await replaceInitiativeProjects(tx, ctx, w, q.id, archived, q.project_ids);
          }
          const row = await one(
            tx,
            sql`update roster.initiatives set name=${q.name ?? current.name},description=${
              q.description ?? current.description
            },archived=${archived} where workspace_id=${w.id} and id=${q.id} returning *`,
          );
          return await initiativeOutput(tx, ctx, w, row);
        })
      );
    },
  };
}
