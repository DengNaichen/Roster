import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Issue, type RequestContext, statuses } from '../../../../../contracts/mod.ts';
import type { Service } from '../../../application/mod.ts';
import type { Database } from '../../../platform/database/client.ts';
import { type Executor, one, type Row, rows } from '../../../platform/database/query.ts';
import { createSession } from '../../../platform/database/session.ts';
import { fail } from '../../../platform/errors/validation.ts';
import { iso } from '../../../platform/time.ts';
import { workspace } from '../../access/index.ts';
import { visible } from '../../access/postgres.ts';
import { hydrateIssueActivity } from '../../activity/index.ts';
import { buildLabelFilter } from '../../labels/postgres.ts';
import { visibleProject } from '../../planning/postgres.ts';
import { issueDTO } from '../domain/mapper.ts';
import { hydrateIssueCatalog } from './catalog-query.ts';
import { issueSelect, readIssue } from './read-model.ts';

export async function assignee(
  db: Executor,
  w: Row,
  t: Row,
  subject: string | null | undefined,
) {
  if (!subject) return null;
  const m = (await rows(
    db,
    sql`select 1 from roster.workspace_members wm where workspace_id=${w.id} and subject=${subject} and status='active' and (${!t
      .private} or exists(select 1 from roster.team_members where team_id=${t.id} and subject=${subject}))`,
  ))[0];
  if (!m) {
    fail('invalid_input', 'Assignee must be an active member with team access');
  }
  return subject;
}
function publicAuditSnapshot(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    // References are exposed only through the current permission-filtered DTO.
    // Historical snapshots must not reveal references that became private.
    const { parent_id, project_id, cycle_id, workspace_id, team_id, ...snapshot } = value as Row;
    return snapshot;
  }
  return value;
}
export async function hydrateCoreIssues(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  items: Row[],
): Promise<Issue[]> {
  const hydrated = await hydrateIssueCatalog(db, ctx, String(w.id), items);
  const parentIds = [...new Set(items.filter((i) => i.parent_id).map((i) => String(i.parent_id)))];
  const parents = parentIds.length
    ? await rows(
      db,
      sql`select i.id,i.identifier from roster.issues i join roster.teams t on t.id=i.team_id where i.workspace_id=${w.id} and i.id in (${
        sql.join(parentIds.map((id) => sql`${id}::uuid`), sql`,`)
      }) and ${visible(ctx.identity.subject)}`,
    )
    : [];
  const names = new Map(parents.map((p) => [String(p.id), String(p.identifier)]));
  return hydrated.map((r) =>
    issueDTO({ ...r, parent: r.parent_id ? names.get(String(r.parent_id)) ?? null : null })
  );
}
export async function validateParent(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  input: string | undefined,
  current: Row | null,
) {
  if (input === undefined) return current?.parent_id ?? null;
  if (input === '') return null;
  const p = await readIssue(db, ctx, w, input);
  if (current) {
    if (p.id === current.id) fail('invalid_input', 'An issue cannot be its own parent');
    const cycle = await rows(
      db,
      sql`with recursive ancestors(id,parent_id) as(select id,parent_id from roster.issues where id=${p.id} union select i.id,i.parent_id from roster.issues i join ancestors a on i.id=a.parent_id) select 1 from ancestors where id=${current.id}`,
    );
    if (cycle.length) fail('invalid_input', 'Parent cycle is not allowed');
  }
  return p.id;
}

export function createIssueQueries(db: Database): Pick<Service, 'listIssues' | 'getIssue'> {
  const session = createSession(db);
  return {
    async listIssues(ctx, slug, input = {}) {
      const w = await workspace(session, ctx, slug);
      const limit = input.limit === undefined || input.limit === 0 ? 50 : input.limit;
      if (!Number.isSafeInteger(limit)) fail('invalid_input', 'Limit must be an integer');
      const all = limit < 0;
      const sort = input.sort ?? (input.status === 'agent_ready' ? 'priority' : 'updated');
      if (input.status && !statuses.includes(input.status)) {
        fail('invalid_input', 'Invalid status');
      }
      if (input.cursor && !/^[0-9a-f-]{36}$/i.test(input.cursor)) {
        fail('invalid_input', 'Invalid cursor');
      }
      const predicates = [
        sql`i.workspace_id=${w.id}`,
        visible(ctx.identity.subject),
      ];
      if (input.team) predicates.push(sql`t.key=${input.team}`);
      if (input.status) predicates.push(sql`i.status=${input.status}`);
      if (input.type !== undefined) {
        predicates.push(input.type === '' ? sql`i.type is null` : sql`i.type=${input.type}`);
      }
      if (input.priority !== undefined) predicates.push(sql`i.priority=${input.priority}`);
      if (input.assigned_to_me && input.assignee !== undefined) {
        fail('invalid_input', 'Cannot combine assignee and assigned_to_me');
      }
      if (input.assigned_to_me) predicates.push(sql`i.assignee_subject=${ctx.identity.subject}`);
      if (input.assignee !== undefined) {
        predicates.push(
          input.assignee === null
            ? sql`i.assignee_subject is null`
            : sql`i.assignee_subject=${input.assignee}`,
        );
      }

      if (input.cycle_id !== undefined) {
        predicates.push(
          input.cycle_id === 0 ? sql`i.cycle_id is null` : sql`i.cycle_id=${input.cycle_id}`,
        );
      }
      if (input.parent) {
        const parent = await readIssue(db, ctx, w, input.parent);
        predicates.push(sql`i.parent_id=${parent.id}`);
      }
      if (input.project_id || input.project !== undefined) {
        if (input.project === '') {
          if (input.project_id) fail('invalid_input', 'Project references disagree');
          predicates.push(sql`i.project_id is null`);
        } else {
          const p = await one(
            db,
            sql`select p.id from roster.projects p where p.workspace_id=${w.id} and ${
              visibleProject(ctx.identity.subject)
            } ${input.project_id ? sql`and p.id=${input.project_id}` : sql``} ${
              input.project !== undefined ? sql`and p.name=${input.project}` : sql``
            }`,
          );
          predicates.push(sql`i.project_id=${p.id}`);
        }
      }
      predicates.push(
        await buildLabelFilter(db, String(w.id), {
          label_mode: input.label_mode,
          label_ids: input.label_ids,
          label_group_ids: input.label_group_ids,
        }),
      );
      if (input.query) {
        predicates.push(
          sql`(i.title ilike ${'%' + input.query + '%'} or i.description ilike ${
            '%' + input.query + '%'
          })`,
        );
      }
      if (input.cursor) {
        const boundary = (await rows(
          db,
          sql`${issueSelect} where ${
            sql.join(predicates, sql` and `)
          } and i.id=${input.cursor}::uuid`,
        ))[0];
        if (!boundary) fail('invalid_input', 'Cursor is unavailable for this query');
        if (sort === 'updated') {
          predicates.push(sql`(i.updated_at,i.id)<(${boundary.updated_at},${boundary.id}::uuid)`);
        } else if (sort === 'priority') {
          const priority = Number(boundary.priority) || 5;
          predicates.push(
            sql`((case when i.priority=0 then 5 else i.priority end)>${priority} or ((case when i.priority=0 then 5 else i.priority end)=${priority} and (i.updated_at,i.id)<(${boundary.updated_at},${boundary.id}::uuid)))`,
          );
        } else {predicates.push(
            sql`(i.created_at,i.id)<(${boundary.created_at},${boundary.id}::uuid)`,
          );}
      }
      const rs = await rows(
        db,
        sql`${issueSelect} where ${sql.join(predicates, sql` and `)} order by ${
          sort === 'updated'
            ? sql`i.updated_at desc,i.id desc`
            : sort === 'priority'
            ? sql`case when i.priority=0 then 5 else i.priority end,i.updated_at desc,i.id desc`
            : sql`i.created_at desc,i.id desc`
        } ${all ? sql`` : sql`limit ${limit + 1}`}`,
      );
      return {
        items: await hydrateCoreIssues(db, ctx, w, all ? rs : rs.slice(0, limit)),
        next_cursor: !all && rs.length > limit ? String(rs[limit - 1].id) : null,
      };
    },
    async getIssue(ctx, slug, identifier) {
      const w = await workspace(session, ctx, slug);
      const r = await readIssue(db, ctx, w, identifier);
      const events = await rows(
        db,
        sql`select id::text,kind,actor_subject,before,after,created_at from roster.audit_events where issue_id=${r.id} order by roster.audit_events.id`,
      );
      const children = await rows(
        db,
        sql`${issueSelect} where i.workspace_id=${w.id} and i.parent_id=${r.id} and ${
          visible(ctx.identity.subject)
        } order by i.updated_at desc,i.id desc`,
      );
      const detail = {
        ...(await hydrateCoreIssues(db, ctx, w, [r]))[0],
        children: await hydrateCoreIssues(db, ctx, w, children),
        audit: events.map((e) => ({
          ...e,
          before: publicAuditSnapshot(e.before),
          after: publicAuditSnapshot(e.after),
          created_at: iso(e.created_at),
        })) as unknown as Awaited<
          ReturnType<Service['getIssue']>
        >['audit'],
      };
      return hydrateIssueActivity(session, ctx, w, detail);
    },
  };
}
