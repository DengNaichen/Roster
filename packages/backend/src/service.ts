import { createSpecService } from './modules/spec.ts';
import { sql } from 'npm:drizzle-orm@0.45.4';
import {
  buildLabelFilter,
  createCatalogService,
  hydrateIssueCatalog,
  resolveIssueProject,
  visibleProject,
} from './modules/catalog.ts';
import { createActivityService, hydrateIssueActivity } from './modules/activity.ts';
import { createCycleService, validateIssueCycle } from './modules/cycles.ts';
import * as schemas from '../../contracts/schemas.ts';
import {
  admin,
  audit,
  digest,
  type Executor,
  fail,
  identity,
  iso,
  issueDTO,
  issueSelect,
  manager,
  one,
  readIssue,
  type Row,
  rows,
  saveIdentity,
  team,
  teamDTO,
  text,
  visible,
  workspace,
} from './modules/shared.ts';
import type { Database } from './db/client.ts';
import {
  AppError,
  type Identity,
  type Issue,
  issueTypes,
  type RequestContext,
  type Service,
  statuses,
  type Team,
} from '../../contracts/mod.ts';

function validateIssue(input: Record<string, unknown>) {
  if (input.title !== undefined) text(input.title, 'Title');
  if (
    input.description !== undefined && typeof input.description !== 'string'
  ) fail('invalid_input', 'Invalid description');
  if (input.status !== undefined && !statuses.includes(input.status as never)) {
    fail('invalid_input', 'Invalid status');
  }
  if (
    input.type !== undefined && input.type !== null &&
    !issueTypes.includes(input.type as never)
  ) fail('invalid_input', 'Invalid type');
  if (
    input.priority !== undefined &&
    (!Number.isInteger(input.priority) || Number(input.priority) < 0 ||
      Number(input.priority) > 4)
  ) fail('invalid_input', 'Invalid priority');
  if (
    input.assignee !== undefined && input.assignee !== null &&
    typeof input.assignee !== 'string'
  ) fail('invalid_input', 'Invalid assignee');
}
async function assignee(
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
async function hydrateCoreIssues(
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
async function validateParent(
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
export function createService(db: Database, options: { now?: () => Date } = {}): Service {
  const clock = options.now ?? (() => new Date());

  const service: Service = {
    ...createCatalogService(db),
    ...createSpecService(db, { now: clock }),
    ...createCycleService(db, { now: clock }),
    ...createActivityService(db),
    async listWorkspaces(ctx) {
      identity(ctx);
      const rs = await rows(
        db,
        sql`select w.*,m.role from roster.workspaces w join roster.workspace_members m on m.workspace_id=w.id where m.subject=${ctx.identity.subject} and m.status='active' order by w.slug`,
      );
      return rs as unknown as Awaited<ReturnType<Service['listWorkspaces']>>;
    },
    async createWorkspace(ctx, input) {
      const name = text(input.name, 'Name');
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.slug)) {
        fail('invalid_input', 'Invalid workspace slug');
      }
      return db.transaction(async (tx) => {
        await saveIdentity(tx, ctx);
        const w = await one(
          tx,
          sql`insert into roster.workspaces(slug,name) values(${input.slug},${name}) returning *`,
        );
        await tx.execute(
          sql`insert into roster.workspace_members values(${w.id},${ctx.identity.subject},'admin','active')`,
        );
        await audit(tx, ctx, w, 'workspace.created', null, w);
        return { ...w, role: 'admin' } as unknown as Awaited<
          ReturnType<Service['createWorkspace']>
        >;
      });
    },
    async updateWorkspace(ctx, slug, input) {
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        admin(w);
        const n = await one(
          tx,
          sql`update roster.workspaces set name=${
            text(input.name, 'Name')
          } where id=${w.id} returning *`,
        );
        await audit(tx, ctx, w, 'workspace.updated', w, n);
        return { ...n, role: w.role } as unknown as Awaited<
          ReturnType<Service['updateWorkspace']>
        >;
      });
    },
    async listMembers(ctx, slug) {
      const w = await workspace(db, ctx, slug);
      return await rows(
        db,
        sql`select u.*,m.role,m.status from roster.workspace_members m join roster.users u on u.subject=m.subject where m.workspace_id=${w.id} order by u.name,u.subject`,
      ) as unknown as Awaited<ReturnType<Service['listMembers']>>;
    },
    async updateMember(ctx, slug, input) {
      if (
        !['admin', 'member'].includes(input.role) ||
        !['active', 'suspended'].includes(input.status)
      ) fail('invalid_input', 'Invalid membership');
      await db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        admin(w);
        const m = await one(
          tx,
          sql`select * from roster.workspace_members where workspace_id=${w.id} and subject=${input.subject}`,
        );
        if (
          m.role === 'admin' && m.status === 'active' &&
          (input.role !== 'admin' || input.status !== 'active')
        ) {
          const count = await one(
            tx,
            sql`select count(*)::int as n from roster.workspace_members where workspace_id=${w.id} and role='admin' and status='active'`,
          );
          if (count.n === 1) {
            fail('conflict', 'Cannot remove the last active administrator');
          }
        }
        await tx.execute(
          sql`update roster.workspace_members set role=${input.role},status=${input.status} where workspace_id=${w.id} and subject=${input.subject}`,
        );
        await audit(tx, ctx, w, 'member.updated', m, input);
      });
    },
    async resetInvite(ctx, slug) {
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        admin(w);
        const token = Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (b) => b.toString(16).padStart(2, '0'),
        ).join('');
        await tx.execute(
          sql`insert into roster.workspace_invites values(${w.id},${await digest(
            token,
          )}) on conflict(workspace_id) do update set digest=excluded.digest`,
        );
        await audit(tx, ctx, w, 'invite.reset', null, null);
        return { token };
      });
    },
    async joinWorkspace(ctx, input) {
      identity(ctx);
      return db.transaction(async (tx) => {
        const w = await one(
          tx,
          sql`select w.* from roster.workspaces w join roster.workspace_invites v on v.workspace_id=w.id where v.digest=${await digest(
            text(input.token, 'Token'),
          )} for update of w`,
        );
        // The invite join may have read before waiting for the workspace lock.
        // Read it again after the lock so a completed reset invalidates that snapshot.
        const currentInvite = (await rows(
          tx,
          sql`select 1 from roster.workspace_invites where workspace_id=${w.id} and digest=${await digest(
            input.token,
          )}`,
        ))[0];
        if (!currentInvite) fail('not_found', 'Invitation unavailable');
        const m = (await rows(
          tx,
          sql`select * from roster.workspace_members where workspace_id=${w.id} and subject=${ctx.identity.subject}`,
        ))[0];
        if (m?.status === 'suspended') {
          fail('forbidden', 'Membership is suspended');
        }
        await saveIdentity(tx, ctx);
        await tx.execute(
          sql`insert into roster.workspace_members values(${w.id},${ctx.identity.subject},'member','active') on conflict do nothing`,
        );
        await audit(tx, ctx, w, 'member.joined', null, {
          subject: ctx.identity.subject,
        });
        return { ...w, role: m?.role ?? 'member' } as unknown as Awaited<
          ReturnType<Service['joinWorkspace']>
        >;
      });
    },
    async listTeams(ctx, slug) {
      const all = await service.teamDirectory(ctx, slug);
      return all.filter((t) => t.accessible);
    },
    async teamDirectory(ctx, slug) {
      const w = await workspace(db, ctx, slug);
      const ts = await rows(
        db,
        sql`select t.*,exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${ctx.identity.subject}) as joined,exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${ctx.identity.subject} and tm.role='owner') as owner from roster.teams t where t.workspace_id=${w.id} and (${
          w.role === 'admin'
        } or ${visible(ctx.identity.subject)}) order by t.key`,
      );
      return ts.map((t) => teamDTO(t, w));
    },
    async createTeam(ctx, slug, input) {
      if (
        !/^[A-Z][A-Z0-9]{1,5}$/.test(input.key) ||
        !Number.isSafeInteger(input.start_number ?? 1) ||
        (input.start_number ?? 1) < 1
      ) fail('invalid_input', 'Invalid team key or starting number');
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await one(
          tx,
          sql`insert into roster.teams(workspace_id,key,name,emoji,private,next_number) values(${w.id},${input.key},${
            text(input.name, 'Name')
          },${input.emoji ?? ''},${input.private ?? false},${input.start_number ?? 1}) returning *`,
        );
        await tx.execute(
          sql`insert into roster.team_members values(${w.id},${t.id},${ctx.identity.subject},'owner')`,
        );
        await audit(tx, ctx, w, 'team.created', null, t);
        return teamDTO({ ...t, joined: true, owner: true }, w);
      });
    },
    async updateTeam(ctx, slug, key, input) {
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, key, true);
        if (input.private !== undefined) manager(t, w);
        if (input.private !== undefined && typeof input.private !== 'boolean') {
          fail('invalid_input', 'Invalid visibility');
        }
        const r = await one(
          tx,
          sql`update roster.teams set name=${
            input.name === undefined ? t.name : text(input.name, 'Name')
          },emoji=${input.emoji ?? t.emoji},private=${
            input.private ?? t.private
          } where id=${t.id} returning *`,
        );
        if (input.private && !t.private) {
          await tx.execute(
            sql`insert into roster.team_members values(${w.id},${t.id},${ctx.identity.subject},'owner') on conflict(team_id,subject) do update set role='owner'`,
          );
        }
        await audit(tx, ctx, w, 'team.updated', t, r);
        return teamDTO(await team(tx, ctx, w, key, true), w);
      });
    },
    async listAssignees(ctx, slug, key) {
      const w = await workspace(db, ctx, slug);
      const t = await team(db, ctx, w, key);
      return await rows(
        db,
        sql`select u.* from roster.users u join roster.workspace_members wm on wm.subject=u.subject where wm.workspace_id=${w.id} and wm.status='active' and (${!t
          .private} or exists(select 1 from roster.team_members tm where tm.team_id=${t.id} and tm.subject=u.subject)) order by u.name,u.subject`,
      ) as unknown as Identity[];
    },
    async listTeamMembers(ctx, slug, key) {
      const w = await workspace(db, ctx, slug);
      const t = await team(db, ctx, w, key, true);
      return await rows(
        db,
        sql`select u.*,case when wm.role='admin' then 'owner' else tm.role end as role,wm.status,(wm.role='admin') as workspace_admin from roster.team_members tm join roster.users u on u.subject=tm.subject join roster.workspace_members wm on wm.subject=tm.subject and wm.workspace_id=tm.workspace_id where tm.team_id=${t.id} order by u.name,u.subject`,
      ) as unknown as Awaited<ReturnType<Service['listTeamMembers']>>;
    },
    async changeTeamMember(ctx, slug, key, input) {
      if (!input.remove && !['owner', 'member'].includes(input.role ?? '')) {
        fail('invalid_input', 'Invalid team role');
      }
      await db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, key, true);
        manager(t, w);
        if (!input.remove) {
          await one(
            tx,
            sql`select 1 from roster.workspace_members where workspace_id=${w.id} and subject=${input.subject} and status='active'`,
          );
        }
        if (input.remove) {
          await tx.execute(
            sql`delete from roster.team_members where team_id=${t.id} and subject=${input.subject}`,
          );
        } else {await tx.execute(
            sql`insert into roster.team_members values(${w.id},${t.id},${input.subject},${input.role}) on conflict(team_id,subject) do update set role=excluded.role`,
          );}
        await audit(tx, ctx, w, 'team.member_changed', null, {
          team: key,
          ...input,
        });
      });
    },
    async joinTeam(ctx, slug, key, input) {
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, key, true);
        if (input.leave) {
          await tx.execute(
            sql`delete from roster.team_members where team_id=${t.id} and subject=${ctx.identity.subject}`,
          );
        } else {
          if (t.private && !t.joined) {
            admin(w);
            if (!input.confirm_private) {
              fail('invalid_input', 'Confirm private team access');
            }
          }
          await tx.execute(
            sql`insert into roster.team_members values(${w.id},${t.id},${ctx.identity.subject},'member') on conflict do nothing`,
          );
        }
        await audit(
          tx,
          ctx,
          w,
          input.leave ? 'team.left' : 'team.joined',
          null,
          { team: key },
        );
        return teamDTO({
          ...t,
          joined: !input.leave,
          owner: input.leave ? false : t.owner,
        }, w);
      });
    },
    async listIssues(ctx, slug, input = {}) {
      const w = await workspace(db, ctx, slug);
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
      const w = await workspace(db, ctx, slug);
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
      return hydrateIssueActivity(db, ctx, w, detail);
    },
    async createIssue(ctx, slug, input) {
      validateIssue(input);
      text(input.title, 'Title');
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, input.team);
        const who = await assignee(tx, w, t, input.assignee);
        const project = await resolveIssueProject(tx, ctx, String(w.id), String(t.id), input, null);
        const cycle = await validateIssueCycle(tx, t, input.cycle_id, null, clock());
        const parent = await validateParent(tx, ctx, w, input.parent, null);
        const n = await one(
          tx,
          sql`update roster.teams set next_number=next_number+1 where id=${t.id} returning next_number-1 as n`,
        );
        const r = await one(
          tx,
          sql`insert into roster.issues(workspace_id,team_id,number,identifier,title,description,status,type,priority,assignee_subject,project_id,cycle_id,parent_id) values(${w.id},${t.id},${n.n},${
            input.team + '-' + n.n
          },${input.title.trim()},${input.description ?? ''},${input.status ?? 'triage'},${
            input.type ?? null
          },${input.priority ?? 0},${who},${project},${cycle},${parent}) returning *`,
        );
        await audit(tx, ctx, w, 'issue.created', null, r, String(r.id));
        return (await hydrateCoreIssues(tx, ctx, w, [
          await readIssue(tx, ctx, w, String(r.identifier)),
        ]))[0];
      });
    },
    async updateIssue(ctx, slug, identifier, input) {
      validateIssue(input);
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const r = await readIssue(tx, ctx, w, identifier);
        const t = await team(tx, ctx, w, String(r.team));
        const project = await resolveIssueProject(
          tx,
          ctx,
          String(w.id),
          String(t.id),
          input,
          r.project_id == null ? null : Number(r.project_id),
        );
        const cycle = await validateIssueCycle(
          tx,
          t,
          input.cycle_id,
          r.cycle_id == null ? null : Number(r.cycle_id),
          clock(),
        );
        const parent = await validateParent(tx, ctx, w, input.parent, r);
        const who = input.assignee === undefined
          ? r.assignee_subject
          : await assignee(tx, w, t, input.assignee);
        await tx.execute(
          sql`update roster.issues set title=${input.title?.trim() ?? r.title},description=${
            input.description ?? r.description
          },status=${input.status ?? r.status},type=${
            input.type === undefined ? r.type : input.type
          },priority=${
            input.priority ?? r.priority
          },assignee_subject=${who},project_id=${project},cycle_id=${cycle},parent_id=${parent},updated_at=clock_timestamp() where id=${r.id}`,
        );
        const after = await readIssue(tx, ctx, w, identifier);
        await audit(tx, ctx, w, 'issue.updated', r, after, String(r.id));
        return (await hydrateCoreIssues(tx, ctx, w, [after]))[0];
      });
    },
  };
  const validators: Record<
    string,
    {
      safeParse: (
        value: unknown,
      ) => { success: boolean; data?: unknown; error?: unknown };
    }
  > = {
    createWorkspace: schemas.createWorkspaceSchema,
    updateWorkspace: schemas.updateWorkspaceSchema,
    updateMember: schemas.updateMemberSchema,
    joinWorkspace: schemas.joinWorkspaceSchema,
    createTeam: schemas.createTeamSchema,
    updateTeam: schemas.updateTeamSchema,
    changeTeamMember: schemas.changeTeamMemberSchema,
    joinTeam: schemas.joinTeamSchema,
    listIssues: schemas.listIssuesSchema,
    createIssue: schemas.createIssueSchema,
    updateIssue: schemas.updateIssueSchema,
  };
  const inputIndex: Record<string, number> = {
    createWorkspace: 1,
    joinWorkspace: 1,
    updateTeam: 3,
    changeTeamMember: 3,
    joinTeam: 3,
    updateIssue: 3,
  };
  return new Proxy(service, {
    get(target, key: keyof Service) {
      const method = target[key];
      if (typeof method !== 'function') return method;
      return async (...args: unknown[]) => {
        identity(args[0] as RequestContext);
        const validator = validators[key];
        if (validator) {
          const index = inputIndex[key] ?? 2;
          const result = validator.safeParse(args[index] ?? {});
          if (!result.success) fail('invalid_input', 'Invalid input');
          args[index] = result.data;
        }
        try {
          return await (method as (...values: unknown[]) => unknown)(...args);
        } catch (error) {
          let cause: unknown = error;
          for (let i = 0; i < 4 && cause; i++) {
            const e = cause as { code?: string; cause?: unknown };
            if (e.code === '23505') fail('conflict', 'Resource already exists');
            if (
              ['23503', '23514', '22003', '22P02'].includes(e.code ?? '')
            ) fail('invalid_input', 'Invalid reference or field value');
            cause = e.cause;
          }
          throw error;
        }
      };
    },
  });
}
