import type { RequestContext } from '../../../../../contracts/mod.ts';
import type { Row } from '../../../application/records.ts';
export interface AuditRepository {
  append(
    ctx: RequestContext,
    w: Row,
    kind: string,
    before: unknown,
    after: unknown,
    issueId: string | null,
  ): Promise<void>;
}
