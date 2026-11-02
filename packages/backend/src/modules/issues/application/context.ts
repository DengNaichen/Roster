import type { RequestContext } from '../../../../../contracts/mod.ts';
import type { Row } from '../../../application/records.ts';
import type { Session } from '../../../application/session.ts';
export function readIssue(db: Session, ctx: RequestContext, w: Row, id: string) {
  return db.issues.readIssue(ctx, w, id);
}
export function hydrateIssueCatalog(
  db: Session,
  ctx: RequestContext,
  workspaceId: string,
  issues: Row[],
) {
  return db.issues.hydrateCatalog(ctx, workspaceId, issues);
}
