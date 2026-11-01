import { type SQL, sql } from 'npm:drizzle-orm@0.45.4';
import * as schemas from '../../contracts/schemas.ts';
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

type Row = Record<string, unknown>;
type Executor = Pick<Database, 'execute'>;
const fail = (
  code: ConstructorParameters<typeof AppError>[0],
  message: string,
): never => {
  throw new AppError(code, message);
};
async function rows(db: Executor, query: SQL): Promise<Row[]> {
  return (await db.execute(query)).rows as Row[];
}
async function one(db: Executor, query: SQL): Promise<Row> {
  const row = (await rows(db, query))[0];
  return row ?? fail('not_found', 'Resource not found');
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail('invalid_input', `${label} is required`);
  }
  return (value as string).trim();
}
function identity(ctx: RequestContext): Identity {
  if (!ctx?.identity?.subject) {
    fail('unauthenticated', 'Authentication required');
  }
  return ctx.identity;
}
async function saveIdentity(db: Executor, ctx: RequestContext) {
  const u = identity(ctx);
  await db.execute(
    sql`insert into roster.users(subject,name,email) values(${u.subject},${u.name},${u.email}) on conflict(subject) do update set name=excluded.name,email=excluded.email`,
  );
}
async function workspace(
  db: Executor,
  ctx: RequestContext,
  slug: string,
  lock = false,
): Promise<Row> {
  const u = identity(ctx);
  const w = await one(
    db,
    sql`select * from roster.workspaces where slug=${slug}${lock ? sql` for update` : sql``}`,
  );
  const m = (await rows(
    db,
    sql`select role from roster.workspace_members where workspace_id=${w.id} and subject=${u.subject} and status='active'`,
  ))[0];
  if (!m) fail('forbidden', 'Workspace access denied');
  return { ...w, role: m.role };
}
function admin(w: Row) {
  if (w.role !== 'admin') fail('forbidden', 'Administrator required');
}
function visible(subject: string) {
  return sql`(not t.private or exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${subject}))`;
}
async function team(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  key: string,
  settings = false,
) {
  const t = await one(
    db,
    sql`select t.*, exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${ctx.identity.subject}) as joined, exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${ctx.identity.subject} and tm.role='owner') as owner from roster.teams t where t.workspace_id=${w.id} and t.key=${key}`,
  );
  if (t.private && !t.joined && !(settings && w.role === 'admin')) {
    fail('not_found', 'Team not found');
  }
  return t;
}
function teamDTO(t: Row, w: Row): Team {
  const accessible = !t.private || Boolean(t.joined);
  return {
    id: String(t.id),
    key: String(t.key),
    name: String(t.name),
    emoji: String(t.emoji),
    private: Boolean(t.private),
    joined: Boolean(t.joined),
    accessible,
    can_manage: w.role === 'admin' || Boolean(t.owner),
    next_number: accessible ? Number(t.next_number) : null,
  };
}
function manager(t: Row, w: Row) {
  if (w.role !== 'admin' && !t.owner) fail('forbidden', 'Team owner required');
}
async function digest(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
async function audit(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  kind: string,
  before: unknown,
  after: unknown,
  issueId: string | null = null,
) {
  await db.execute(
    sql`insert into roster.audit_events(workspace_id,issue_id,actor_subject,kind,before,after) values(${w.id},${issueId},${ctx.identity.subject},${kind},${
      JSON.stringify(before)
    }::jsonb,${JSON.stringify(after)}::jsonb)`,
  );
}
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
const issueSelect =
  sql`select i.*,t.key as team,u.subject as user_subject,u.name as user_name,u.email as user_email from roster.issues i join roster.teams t on t.id=i.team_id left join roster.users u on u.subject=i.assignee_subject`;
function iso(value: unknown) {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}
function issueDTO(r: Row): Issue {
  return {
    id: String(r.id),
    identifier: String(r.identifier),
    team: String(r.team),
    title: String(r.title),
    description: String(r.description),
    status: r.status as Issue['status'],
    type: r.type as Issue['type'],
    priority: Number(r.priority),
    assignee: r.user_subject
      ? {
        subject: String(r.user_subject),
        name: String(r.user_name),
        email: String(r.user_email),
      }
      : null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
async function readIssue(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  id: string,
) {
  return one(
    db,
    sql`${issueSelect} where i.workspace_id=${w.id} and i.identifier=${id} and ${
      visible(ctx.identity.subject)
    }`,
  );
}
export function createService(db: Database): Service {
  const service: Service = {
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
        if (m.status === 'active' && input.status === 'suspended') {
          const owned = await rows(
            tx,
            sql`select t.* from roster.teams t join roster.team_members tm on tm.team_id=t.id where t.workspace_id=${w.id} and tm.subject=${input.subject} and tm.role='owner'`,
          );
          for (const t of owned) await guardOwner(tx, t, input.subject, true);
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
        manager(t, w);
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
        sql`select u.*,tm.role,wm.status from roster.team_members tm join roster.users u on u.subject=tm.subject join roster.workspace_members wm on wm.subject=tm.subject and wm.workspace_id=tm.workspace_id where tm.team_id=${t.id} order by u.name,u.subject`,
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
        const m = await one(
          tx,
          sql`select * from roster.workspace_members where workspace_id=${w.id} and subject=${input.subject} and (${
            Boolean(input.remove)
          } or status='active')`,
        );
        void m;
        await guardOwner(
          tx,
          t,
          input.subject,
          input.remove || input.role !== 'owner',
        );
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
          await guardOwner(tx, t, ctx.identity.subject, true);
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
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        fail('invalid_input', 'Limit must be 1–100');
      }
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
        predicates.push(sql`(i.created_at,i.id)<(${boundary.created_at},${boundary.id}::uuid)`);
      }
      const rs = await rows(
        db,
        sql`${issueSelect} where ${
          sql.join(predicates, sql` and `)
        } order by i.created_at desc,i.id desc limit ${limit + 1}`,
      );
      return {
        items: rs.slice(0, limit).map(issueDTO),
        next_cursor: rs.length > limit ? String(rs[limit - 1].id) : null,
      };
    },
    async getIssue(ctx, slug, identifier) {
      const w = await workspace(db, ctx, slug);
      const r = await readIssue(db, ctx, w, identifier);
      const events = await rows(
        db,
        sql`select id::text,kind,actor_subject,before,after,created_at from roster.audit_events where issue_id=${r.id} order by roster.audit_events.id`,
      );
      return {
        ...issueDTO(r),
        audit: events.map((e) => ({
          ...e,
          created_at: iso(e.created_at),
        })) as unknown as Awaited<ReturnType<Service['getIssue']>>['audit'],
      };
    },
    async createIssue(ctx, slug, input) {
      validateIssue(input);
      text(input.title, 'Title');
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const t = await team(tx, ctx, w, input.team);
        const who = await assignee(tx, w, t, input.assignee);
        const n = await one(
          tx,
          sql`update roster.teams set next_number=next_number+1 where id=${t.id} returning next_number-1 as n`,
        );
        const r = await one(
          tx,
          sql`insert into roster.issues(workspace_id,team_id,number,identifier,title,description,status,type,priority,assignee_subject) values(${w.id},${t.id},${n.n},${
            input.team + '-' + n.n
          },${input.title.trim()},${input.description ?? ''},${input.status ?? 'triage'},${
            input.type ?? null
          },${input.priority ?? 0},${who}) returning *`,
        );
        await audit(tx, ctx, w, 'issue.created', null, r, String(r.id));
        return issueDTO(await readIssue(tx, ctx, w, String(r.identifier)));
      });
    },
    async updateIssue(ctx, slug, identifier, input) {
      validateIssue(input);
      return db.transaction(async (tx) => {
        const w = await workspace(tx, ctx, slug, true);
        const r = await readIssue(tx, ctx, w, identifier);
        const t = await team(tx, ctx, w, String(r.team));
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
          },assignee_subject=${who},updated_at=now() where id=${r.id}`,
        );
        const after = await readIssue(tx, ctx, w, identifier);
        await audit(tx, ctx, w, 'issue.updated', r, after, String(r.id));
        return issueDTO(after);
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
async function guardOwner(
  db: Executor,
  t: Row,
  subject: string,
  removing: boolean,
) {
  if (!removing) return;
  const result = await one(
    db,
    sql`select count(*) filter(where tm.role='owner' and wm.status='active')::int as n,coalesce(bool_or(tm.subject=${subject} and tm.role='owner' and wm.status='active'),false) as target from roster.team_members tm join roster.workspace_members wm on wm.workspace_id=tm.workspace_id and wm.subject=tm.subject where tm.team_id=${t.id}`,
  );
  if (result.target && result.n === 1) {
    fail('conflict', 'Cannot remove the last active team owner');
  }
}
