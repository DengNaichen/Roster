import { sql } from 'npm:drizzle-orm@0.45.4';
import type { Identity, RequestContext, Team } from '../../../../contracts/mod.ts';
import { type Executor, one, type Row, rows } from '../../platform/database/query.ts';
import { fail } from '../../platform/errors/validation.ts';
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
