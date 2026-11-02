import type { RequestContext } from '../../../../../contracts/mod.ts';
import type { Row } from '../../../application/records.ts';
export interface IssuesRepository {
  setPullRequestStatus(workspaceId: string, issueId: unknown, status: string): Promise<void>;

  readIssue(ctx: RequestContext, w: Row, id: string): Promise<Row>;
  hydrateCatalog(ctx: RequestContext, workspaceId: string, issues: Row[]): Promise<Row[]>;

  touchLabeledIssue(input: { issueId: unknown }): Promise<void>;

  rollCycle(input: { nextCycleId: unknown; now: Date; cycleId: unknown }): Promise<void>;
  clearPendingCycles(input: { clock: Date; teamId: unknown }): Promise<void>;
  markDelegated(input: { issueId: unknown }): Promise<Row>;
}
