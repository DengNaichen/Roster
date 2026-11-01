import { type SQL, sql } from 'npm:drizzle-orm@0.45.4';
import { z } from 'zod';
import * as schemas from '../../../contracts/catalog.ts';
import type {
  CatalogService,
  Initiative,
  Label,
  LabelFilterInput,
  Project,
} from '../../../contracts/catalog.ts';
import { AppError, type RequestContext } from '../../../contracts/mod.ts';
import type { Database } from '../db/client.ts';
import {
  type Executor,
  fail,
  one,
  readIssue,
  type Row,
  rows,
  team,
  visible,
  workspace,
} from './shared.ts';

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    return fail(
      'invalid_input',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  return result.data;
}
function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'cause' in error ? databaseCode(error.cause) : undefined;
}
async function translate<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = databaseCode(error);
    if (code === '23505') fail('conflict', 'A catalog entry with this name already exists');
    if (code === '23503' || code === '23514') {
      fail('invalid_input', 'Invalid catalog reference or constraint');
    }
    throw error;
  }
}
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
function labelDTO(row: Row): Label {
  return {
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description),
    color: String(row.color),
    group_id: Number(row.group_id ?? 0),
    archived: Boolean(row.archived),
  };
}
async function labelRow(db: Executor, workspaceId: unknown, id: number): Promise<Row> {
  const row = (await rows(
    db,
    sql`select * from roster.labels where workspace_id=${workspaceId} and id=${id}`,
  ))[0];
  if (!row) fail('not_found', 'Label not found');
  return row;
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
/** Called only after the core query has applied workspace/private-team visibility. */
export async function hydrateIssueCatalog(
  db: Executor,
  _ctx: RequestContext,
  workspaceId: string,
  issues: Row[],
): Promise<Row[]> {
  if (issues.length === 0) return [];
  const ids = sql.join(issues.map((issue) => sql`${issue.id}::uuid`), sql`, `);
  const projects = await rows(
    db,
    sql`select i.id as issue_id,p.id,p.name,p.emoji from roster.issues i left join roster.projects p on p.id=i.project_id and p.workspace_id=i.workspace_id where i.workspace_id=${workspaceId} and i.id in (${ids})`,
  );
  const labels = await rows(
    db,
    sql`select il.issue_id,l.* from roster.issue_labels il join roster.labels l on l.id=il.label_id where il.workspace_id=${workspaceId} and il.issue_id in (${ids}) order by l.name_key,l.id`,
  );
  const projectByIssue = new Map(projects.map((project) => [String(project.issue_id), project]));
  const labelsByIssue = new Map<string, Label[]>();
  for (const label of labels) {
    const id = String(label.issue_id);
    const entries = labelsByIssue.get(id) ?? [];
    entries.push(labelDTO(label));
    labelsByIssue.set(id, entries);
  }
  return issues.map((issue) => {
    const project = projectByIssue.get(String(issue.id));
    return {
      ...issue,
      project_id: project?.id == null ? null : Number(project.id),
      project: project?.id == null ? null : String(project.name),
      project_emoji: project?.id == null ? '' : String(project.emoji),
      labels: labelsByIssue.get(String(issue.id)) ?? [],
    };
  });
}
export async function buildLabelFilter(
  db: Executor,
  workspaceId: string,
  input: LabelFilterInput,
): Promise<SQL> {
  const parsed = parse(
    z.strictObject({
      label_mode: z.enum(['any', 'all', 'none', 'unlabeled']).optional(),
      label_ids: z.array(z.number().int().positive()).optional(),
      label_group_ids: z.array(z.number().int().positive()).optional(),
    }),
    input,
  );
  const mode = parsed.label_mode ?? 'any';
  if (mode === 'unlabeled') {
    if ((parsed.label_ids?.length ?? 0) + (parsed.label_group_ids?.length ?? 0) > 0) {
      fail('invalid_input', 'Unlabeled mode cannot include label selections');
    }
    return sql`not exists(select 1 from roster.issue_labels il where il.issue_id=i.id)`;
  }
  const predicates: SQL[] = [];
  for (const id of parsed.label_ids ?? []) {
    await labelRow(db, workspaceId, id);
    predicates.push(
      sql`exists(select 1 from roster.issue_labels il where il.issue_id=i.id and il.label_id=${id})`,
    );
  }
  for (const id of parsed.label_group_ids ?? []) {
    if (
      !(await rows(
        db,
        sql`select 1 from roster.label_groups where workspace_id=${workspaceId} and id=${id}`,
      )).length
    ) fail('not_found', 'Label group not found');
    predicates.push(
      sql`exists(select 1 from roster.issue_labels il join roster.labels l on l.id=il.label_id where il.issue_id=i.id and l.group_id=${id})`,
    );
  }
  if (predicates.length === 0) return sql`true`;
  const combined = sql`(${sql.join(predicates, mode === 'all' ? sql` and ` : sql` or `)})`;
  return mode === 'none' ? sql`not ${combined}` : combined;
}

export function createCatalogService(db: Database): CatalogService {
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
    async listLabels(ctx, slug, input = {}) {
      const q = parse(schemas.listLabelsSchema, input);
      const w = await workspace(db, ctx, slug);
      return (await rows(
        db,
        sql`select * from roster.labels where workspace_id=${w.id} and (${
          q.include_archived ?? false
        } or not archived) order by name_key,id`,
      )).map(labelDTO);
    },
    async listLabelGroups(ctx, slug, input = {}) {
      parse(schemas.listLabelGroupsSchema, input);
      const w = await workspace(db, ctx, slug);
      return (await rows(
        db,
        sql`select id,name from roster.label_groups where workspace_id=${w.id} order by name_key,id`,
      )).map((row) => ({ id: Number(row.id), name: String(row.name) }));
    },
    async saveLabelGroup(ctx, slug, input) {
      const q = parse(schemas.saveLabelGroupSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const row = !q.id
            ? await one(
              tx,
              sql`insert into roster.label_groups(workspace_id,name,name_key) values(${w.id},${q.name},${q.name.toLowerCase()}) returning id,name`,
            )
            : await one(
              tx,
              sql`update roster.label_groups set name=${q.name},name_key=${q.name.toLowerCase()} where workspace_id=${w.id} and id=${q.id} returning id,name`,
            );
          return { id: Number(row.id), name: String(row.name) };
        })
      );
    },
    async createLabel(ctx, slug, input) {
      const q = parse(schemas.createLabelSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          if (
            q.group_id &&
            !(await rows(
              tx,
              sql`select 1 from roster.label_groups where workspace_id=${w.id} and id=${q.group_id}`,
            )).length
          ) fail('not_found', 'Label group not found');
          return labelDTO(
            await one(
              tx,
              sql`insert into roster.labels(workspace_id,name,name_key,color,description,group_id) values(${w.id},${q.name},${q.name.toLowerCase()},${q.color},${
                q.description ?? ''
              },${q.group_id || null}) returning *`,
            ),
          );
        })
      );
    },
    async updateLabel(ctx, slug, input) {
      const q = parse(schemas.updateLabelSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const current = await labelRow(tx, w.id, q.id);
          const name = q.name ?? String(current.name);
          return labelDTO(
            await one(
              tx,
              sql`update roster.labels set name=${name},name_key=${name.toLowerCase()},color=${
                q.color ?? current.color
              },description=${q.description ?? current.description},archived=${
                q.archived ?? current.archived
              } where workspace_id=${w.id} and id=${q.id} returning *`,
            ),
          );
        })
      );
    },
    async changeIssueLabels(ctx, slug, input) {
      const q = parse(schemas.changeIssueLabelsSchema, input);
      await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const add = [...new Set(q.add ?? [])];
          const remove = [...new Set(q.remove ?? [])];
          if (remove.some((id) => add.includes(id))) {
            fail('invalid_input', 'Cannot add and remove the same label');
          }
          const added: Row[] = [];
          const groups = new Set<number>();
          for (const id of add) {
            const label = await labelRow(tx, w.id, id);
            if (label.group_id !== null) {
              if (groups.has(Number(label.group_id))) {
                fail('invalid_input', 'Cannot add multiple labels in one group');
              }
              groups.add(Number(label.group_id));
            }
            added.push(label);
          }
          for (const id of remove) {
            await labelRow(tx, w.id, id);
          }
          for (const identifier of new Set(q.identifiers)) {
            const issue = await readIssue(tx, ctx, w, identifier);
            let changed = false;
            for (const id of remove) {
              const removed = await rows(
                tx,
                sql`delete from roster.issue_labels where issue_id=${issue.id} and label_id=${id} returning label_id`,
              );
              changed ||= removed.length > 0;
            }
            for (const label of added) {
              if (
                (await rows(
                  tx,
                  sql`select 1 from roster.issue_labels where issue_id=${issue.id} and label_id=${label.id}`,
                )).length
              ) continue;
              if (label.archived) fail('invalid_input', 'Archived labels cannot be newly applied');
              if (label.group_id !== null) {
                await tx.execute(
                  sql`delete from roster.issue_labels il using roster.labels l where il.label_id=l.id and il.issue_id=${issue.id} and l.group_id=${label.group_id}`,
                );
              }
              await tx.execute(
                sql`insert into roster.issue_labels(workspace_id,issue_id,label_id) values(${w.id},${issue.id},${label.id})`,
              );
              changed = true;
            }
            if (changed) {
              await tx.execute(
                sql`update roster.issues set updated_at=clock_timestamp() where id=${issue.id}`,
              );
            }
          }
        })
      );
    },
    async mergeLabels(ctx, slug, input) {
      const q = parse(schemas.mergeLabelsSchema, input);
      await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const source = await labelRow(tx, w.id, q.source_id);
          const target = await labelRow(tx, w.id, q.target_id);
          if (source.group_id !== target.group_id || target.archived) {
            fail('invalid_input', 'Merge target must be active and in the same group');
          }
          const hidden = await rows(
            tx,
            sql`select 1 from roster.issue_labels il join roster.issues i on i.id=il.issue_id join roster.teams t on t.id=i.team_id where il.label_id=${source.id} and not ${
              visible(ctx.identity.subject)
            } limit 1`,
          );
          if (hidden.length) {
            fail('forbidden', 'Cannot merge a label attached to inaccessible issues');
          }
          const affected = await rows(
            tx,
            sql`select issue_id from roster.issue_labels where label_id=${source.id}`,
          );
          await tx.execute(sql`delete from roster.issue_labels where label_id=${source.id}`);
          for (const issue of affected) {
            await tx.execute(
              sql`insert into roster.issue_labels(workspace_id,issue_id,label_id) values(${w.id},${issue.issue_id},${target.id}) on conflict do nothing`,
            );
            await tx.execute(
              sql`update roster.issues set updated_at=clock_timestamp() where id=${issue.issue_id}`,
            );
          }
          await tx.execute(
            sql`delete from roster.labels where workspace_id=${w.id} and id=${source.id}`,
          );
        })
      );
    },
  };
}
