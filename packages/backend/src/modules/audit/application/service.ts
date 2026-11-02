import type { RequestContext } from '../../../../../contracts/mod.ts';
import type { Row } from '../../../application/records.ts';
import type { Session } from '../../../application/session.ts';
export function audit(
  db: Session,
  ctx: RequestContext,
  w: Row,
  kind: string,
  before: unknown,
  after: unknown,
  issueId: string | null = null,
) {
  return db.audit.append(ctx, w, kind, before, after, issueId);
}
