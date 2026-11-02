import { sql } from 'npm:drizzle-orm@0.45.4';
import type { Executor, Row } from '../../platform/database/query.ts';
import { statusFromPullRequest } from './domain/pull-request.ts';
/** Internal system command. Caller must hold the configured repository lease and workspace lock. */
export async function applyPullRequestStatus(
  tx: Executor,
  workspaceId: string,
  issue: Row,
  pullState: string,
  source: string,
) {
  if (String(issue.workspace_id) !== workspaceId) throw new Error('Issue workspace mismatch');
  const status = statusFromPullRequest(String(issue.status), pullState);
  if (status === issue.status) return;
  await tx.execute(
    sql`insert into roster.users(subject,name,email) values('system:github','GitHub','') on conflict do nothing`,
  );
  await tx.execute(
    sql`update roster.issues set status=${status},updated_at=now() where workspace_id=${workspaceId} and id=${issue.id}`,
  );
  await tx.execute(
    sql`insert into roster.audit_events(workspace_id,issue_id,actor_subject,kind,before,after) values(${workspaceId},${issue.id},'system:github','issue.status_changed',${
      JSON.stringify({ status: issue.status })
    }::jsonb,${JSON.stringify({ status, source })}::jsonb)`,
  );
}
