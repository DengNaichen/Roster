import { sql } from 'npm:drizzle-orm@0.45.4';
import type { RequestContext } from '../../../../contracts/mod.ts';
import type { Executor, Row } from '../../platform/database/query.ts';
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
