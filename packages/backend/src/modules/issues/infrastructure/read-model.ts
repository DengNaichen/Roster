import { sql } from 'npm:drizzle-orm@0.45.4';
import type { RequestContext } from '../../../../../contracts/mod.ts';
import { type Executor, one, type Row } from '../../../platform/database/query.ts';
import { visible } from '../../access/postgres.ts';
export const issueSelect =
  sql`select i.*,t.key as team,u.subject as user_subject,u.name as user_name,u.email as user_email from roster.issues i join roster.teams t on t.id=i.team_id left join roster.users u on u.subject=i.assignee_subject`;
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
