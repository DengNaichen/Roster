import type { Row } from '../../../application/records.ts';
import type { Session } from '../../../application/session.ts';
import { ensureGitHubIdentity } from '../../access/index.ts';
import { audit } from '../../audit/index.ts';
import { statusFromPullRequest } from '../domain/pull-request.ts';
/** Internal system command. Caller holds the configured repository lease and Workspace lock. */
export async function applyPullRequestStatus(
  data: Session,
  workspaceId: string,
  issue: Row,
  pullState: string,
  source: string,
) {
  if (String(issue.workspace_id) !== workspaceId) throw new Error('Issue workspace mismatch');
  const status = statusFromPullRequest(String(issue.status), pullState);
  if (status === issue.status) return;
  await ensureGitHubIdentity(data);
  await data.issues.setPullRequestStatus(workspaceId, issue.id, status);
  await audit(
    data,
    { identity: { subject: 'system:github', name: 'GitHub', email: '' } },
    { id: workspaceId },
    'issue.status_changed',
    { status: issue.status },
    { status, source },
    String(issue.id),
  );
}
