import { type SQL, sql } from 'npm:drizzle-orm@0.45.4';
import type { Database } from '../db/client.ts';
import {
  AppError,
  type Identity,
  type Issue,
  type RequestContext,
  type Team,
} from '../../../contracts/mod.ts';
export type Row = Record<string, unknown>;
export type Executor = Pick<Database, 'execute'>;
export const fail = (
  code: ConstructorParameters<typeof AppError>[0],
  message: string,
): never => {
  throw new AppError(code, message);
};
export async function rows(db: Executor, query: SQL): Promise<Row[]> {
  return (await db.execute(query)).rows as Row[];
}
export async function one(db: Executor, query: SQL): Promise<Row> {
  const row = (await rows(db, query))[0];
  return row ?? fail('not_found', 'Resource not found');
}
export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail('invalid_input', `${label} is required`);
  }
  return (value as string).trim();
}
export function identity(ctx: RequestContext): Identity {
  if (!ctx?.identity?.subject) {
    fail('unauthenticated', 'Authentication required');
  }
  return ctx.identity;
}
export async function saveIdentity(db: Executor, ctx: RequestContext) {
  const u = identity(ctx);
  await db.execute(
    sql`insert into roster.users(subject,name,email) values(${u.subject},${u.name},${u.email}) on conflict(subject) do update set name=excluded.name,email=excluded.email`,
  );
}
export async function workspace(
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
export function admin(w: Row) {
  if (w.role !== 'admin') fail('forbidden', 'Administrator required');
}
export function visible(subject: string) {
  return sql`(not t.private or exists(select 1 from roster.team_members tm where tm.team_id=t.id and tm.subject=${subject}))`;
}
export async function team(
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
export function teamDTO(t: Row, w: Row): Team {
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
export function manager(t: Row, w: Row) {
  if (w.role !== 'admin' && !t.owner) fail('forbidden', 'Team owner required');
}
export async function digest(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function audit(
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
export const issueSelect =
  sql`select i.*,t.key as team,u.subject as user_subject,u.name as user_name,u.email as user_email from roster.issues i join roster.teams t on t.id=i.team_id left join roster.users u on u.subject=i.assignee_subject`;
export function iso(value: unknown) {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}
export function issueDTO(r: Row): Issue {
  return {
    id: String(r.id),
    identifier: String(r.identifier),
    team: String(r.team),
    title: String(r.title),
    description: String(r.description),
    status: r.status as Issue['status'],
    type: r.type as Issue['type'],
    priority: Number(r.priority),
    project_id: r.project_id == null ? null : Number(r.project_id),
    project: r.project == null ? null : String(r.project),
    project_emoji: String(r.project_emoji ?? ''),
    cycle_id: r.cycle_id == null ? null : Number(r.cycle_id),
    parent: r.parent == null ? null : String(r.parent),
    labels: (r.labels ?? []) as Issue['labels'],
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
export async function readIssue(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  id: string,
) {
  return one(
    db,
    sql`${issueSelect} where i.workspace_id=${w.id} and ${
      /^[0-9a-f-]{36}$/i.test(id) ? sql`i.id=${id}::uuid` : sql`i.identifier=${id}`
    } and ${visible(ctx.identity.subject)}`,
  );
}
