import type { RequestContext } from '../../../../../contracts/mod.ts';
import type { Row } from '../../../application/records.ts';
import type { Session } from '../../../application/session.ts';
import { audit } from '../../audit/index.ts';
/** Internal transaction-bound capabilities. Callers already hold Workspace and visibility checks. */
export function touchIssue(data: Session, issueId: unknown) {
  return data.issues.touchLabeledIssue({ issueId });
}
export function rollCycleIssues(data: Session, cycleId: unknown, nextCycleId: unknown, now: Date) {
  return data.issues.rollCycle({ cycleId, nextCycleId, now });
}
export function clearPendingCycleIssues(data: Session, teamId: unknown, clock: Date) {
  return data.issues.clearPendingCycles({ teamId, clock });
}
export async function startDelegatedIssue(
  data: Session,
  ctx: RequestContext,
  workspace: Row,
  issue: Row,
) {
  if (issue.status === 'in_progress') return;
  const after = await data.issues.markDelegated({ issueId: issue.id });
  await audit(data, ctx, workspace, 'issue.updated', issue, after, String(issue.id));
}
