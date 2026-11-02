import type { Initiative, Project } from '../../../../../contracts/catalog.ts';
import * as schemas from '../../../../../contracts/catalog.ts';
import { type RequestContext } from '../../../../../contracts/mod.ts';
import type { CatalogService } from '../../../application/catalog.ts';
import type { Row } from '../../../application/records.ts';
import type { Session, UnitOfWork } from '../../../application/session.ts';

import { fail } from '../../../platform/errors/validation.ts';
import { team, workspace } from '../../access/index.ts';

import { translate } from '../../../platform/errors/catalog.ts';
import { parse } from '../../../platform/errors/parse.ts';
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
  db: Session,
  ctx: RequestContext,
  workspaceId: string,
  ref: { id?: number; name?: string },
): Promise<Row> {
  const row = (await db.planning.findProject({
    workspaceId,
    byId: Boolean(ref.id),
    id: (ref.id) ? (ref.id) : undefined,
    name: (!(ref.id)) ? (ref.name) : undefined,
    subject: ctx.identity.subject,
  }))[0];
  if (!row) fail('not_found', 'Project not found');
  if (ref.name && row.name !== ref.name) {
    fail('invalid_input', 'Project id and name must refer to the same project');
  }
  return row;
}
async function projectOutput(
  db: Session,
  ctx: RequestContext,
  w: Row,
  row: Row,
): Promise<Project> {
  const ts = await db.planning.projectTeamKeys({
    recordId: row.id,
    workspaceId: w.id,
    subject: ctx.identity.subject,
  });
  return projectDTO(row, ts.map((t) => String(t.key)));
}
function validateDates(start: unknown, target: unknown) {
  if (start && target && String(start) > String(target)) {
    fail('invalid_input', 'Project start date must not follow target date');
  }
}
async function replaceProjectTeams(
  db: Session,
  ctx: RequestContext,
  w: Row,
  projectId: number,
  keys: string[],
) {
  if (keys.length === 0) fail('invalid_input', 'A project requires at least one team');
  const selected = new Set<string>();
  for (const key of new Set(keys)) selected.add(String((await team(db, ctx, w, key)).id));
  const current = await db.planning.projectTeams({ subject: ctx.identity.subject, projectId });
  for (const t of current) if (!t.visible) selected.add(String(t.id));
  const used = await db.planning.usedProjectTeams({ workspaceId: w.id, projectId });
  if (used.some((row) => !selected.has(String(row.team_id)))) {
    fail('conflict', 'Cannot remove a project team that still has issues');
  }
  for (const t of current) {
    if (!selected.has(String(t.id))) {
      await db.planning.removeProjectTeam({ projectId, teamId: t.id });
    }
  }
  for (const id of selected) {
    await db.planning.addProjectTeam({ workspaceId: w.id, projectId, id });
  }
}
async function initiativeOutput(
  db: Session,
  ctx: RequestContext,
  w: Row,
  row: Row,
): Promise<Initiative> {
  const ps = await db.planning.initiativeProjectIds({
    recordId: row.id,
    workspaceId: w.id,
    subject: ctx.identity.subject,
  });
  return {
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description),
    archived: Boolean(row.archived),
    project_ids: ps.map((p) => Number(p.id)),
  };
}
async function replaceInitiativeProjects(
  db: Session,
  ctx: RequestContext,
  w: Row,
  id: number,
  archived: boolean,
  projects: number[],
) {
  const selected = new Set(projects);
  for (const project of selected) {
    const p = await projectRow(db, ctx, String(w.id), { id: project });
    const linked = (await db.planning.findInitiativeProject({ id, project })).length > 0;
    if (!linked && (archived || p.archived)) {
      fail('conflict', 'Archived initiatives or projects cannot accept new associations');
    }
  }
  const existing = await db.planning.visibleInitiativeProjects({
    id,
    workspaceId: w.id,
    subject: ctx.identity.subject,
  });
  for (const p of existing) {
    if (!selected.has(Number(p.id))) {
      await db.planning.removeInitiativeProject({ initiativeId: id, projectId: p.id });
    }
  }
  for (const project of selected) {
    await db.planning.addInitiativeProject({ workspaceId: w.id, id, project });
  }
}
/** Resolve an issue reference in its existing transaction; omitted means retain. */
export async function resolveIssueProject(
  db: Session,
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
  const compatible =
    (await db.planning.projectTeamExists({ workspaceId, id: p.id, teamId })).length > 0;
  if (!compatible) fail('invalid_input', 'The project is not associated with this team');
  if (p.archived && Number(p.id) !== currentId) {
    fail('conflict', 'Archived projects cannot accept new issues');
  }
  return Number(p.id);
}

export function createPlanningService(
  db: UnitOfWork,
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
      const ps = await db.planning.listProjects({
        workspaceId: w.id,
        subject: ctx.identity.subject,
        include_archived: q.include_archived ?? false,
        hasTeam: Boolean(q.team),
        team: (q.team) ? (q.team) : undefined,
      });
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
          const p = await tx.planning.insertProject({
            workspaceId: w.id,
            name: q.name,
            description: q.description ?? '',
            emoji: q.emoji ?? '',
            start_date: q.start_date || null,
            target_date: q.target_date || null,
          });
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
          const p = await tx.planning.updateProject({
            new_name: q.new_name ?? current.name,
            description: q.description ?? current.description,
            emoji: q.emoji ?? current.emoji,
            archived: q.archived ?? current.archived,
            start,
            target,
            workspaceId: w.id,
            id: current.id,
          });
          return await projectOutput(tx, ctx, w, p);
        })
      );
    },
    async listInitiatives(ctx, slug, input = {}) {
      const q = parse(schemas.listInitiativesSchema, input);
      const w = await workspace(db, ctx, slug);
      const entries = await db.planning.listInitiatives({
        workspaceId: w.id,
        include_archived: q.include_archived ?? false,
      });
      return await Promise.all(entries.map((row) => initiativeOutput(db, ctx, w, row)));
    },
    async getInitiative(ctx, slug, input) {
      const q = parse(schemas.getInitiativeSchema, input);
      const w = await workspace(db, ctx, slug);
      const row = await db.planning.findInitiative({ workspaceId: w.id, id: q.id });
      return await initiativeOutput(db, ctx, w, row);
    },
    async createInitiative(ctx, slug, input) {
      const q = parse(schemas.createInitiativeSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const row = await tx.planning.insertInitiative({
            workspaceId: w.id,
            name: q.name,
            description: q.description ?? '',
          });
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
          const current = await tx.planning.loadInitiative({ workspaceId: w.id, id: q.id });
          const archived = q.archived ?? Boolean(current.archived);
          if (q.project_ids !== undefined) {
            await replaceInitiativeProjects(tx, ctx, w, q.id, archived, q.project_ids);
          }
          const row = await tx.planning.updateInitiative({
            name: q.name ?? current.name,
            description: q.description ?? current.description,
            archived,
            workspaceId: w.id,
            id: q.id,
          });
          return await initiativeOutput(tx, ctx, w, row);
        })
      );
    },
  };
}
