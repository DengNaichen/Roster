import type { Identity, RequestContext, Team } from '../../../../../contracts/mod.ts';
import type { Row } from '../../../application/records.ts';
import type { Session } from '../../../application/session.ts';

import { fail } from '../../../platform/errors/validation.ts';
export function identity(ctx: RequestContext): Identity {
  if (!ctx?.identity?.subject) {
    fail('unauthenticated', 'Authentication required');
  }
  return ctx.identity;
}
export async function saveIdentity(db: Session, ctx: RequestContext) {
  const u = identity(ctx);
  await db.access.saveIdentity({ subject: u.subject, name: u.name, email: u.email });
}
export async function workspace(
  db: Session,
  ctx: RequestContext,
  slug: string,
  lock = false,
): Promise<Row> {
  const u = identity(ctx);
  const w = await db.access.findWorkspace({ slug, lock: Boolean(lock) });
  const m = (await db.access.activeMembership({ workspaceId: w.id, subject: u.subject }))[0];
  if (!m) fail('forbidden', 'Workspace access denied');
  return { ...w, role: m.role };
}
export function admin(w: Row) {
  if (w.role !== 'admin') fail('forbidden', 'Administrator required');
}
export async function team(
  db: Session,
  ctx: RequestContext,
  w: Row,
  key: string,
  settings = false,
) {
  const t = await db.access.findTeam({ subject: ctx.identity.subject, workspaceId: w.id, key });
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

export function lockWorkspace(data: Session, workspaceId: unknown) {
  return data.access.lockWorkspace({ workspace_id: workspaceId });
}
export function allocateIssueNumber(data: Session, teamId: string) {
  return data.access.nextIssueNumber(teamId);
}
export function ensureGitHubIdentity(data: Session) {
  return data.access.ensureGitHubIdentity();
}
