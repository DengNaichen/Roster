import { sql } from 'npm:drizzle-orm@0.45.4';
import type { Issue, RequestContext } from '../../../../../contracts/mod.ts';
import { type Executor, one, type Row } from '../../../platform/database/query.ts';
import { iso } from '../../../platform/time.ts';
import { visible } from '../../access/index.ts';
export const issueSelect =
  sql`select i.*,t.key as team,u.subject as user_subject,u.name as user_name,u.email as user_email from roster.issues i join roster.teams t on t.id=i.team_id left join roster.users u on u.subject=i.assignee_subject`;
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
