import type { Row } from '../../../application/records.ts';
export interface GitHubRepository {
  requestSync(input: { repo: string; workspace: string }): Promise<void>;
  workspace(input: { workspace: string }): Promise<Row>;
  ensureCursor(input: { workspaceId: unknown; repo: string }): Promise<void>;
  claimLease(input: { lease: string; workspaceId: unknown; repo: string }): Promise<Row[]>;
  teamKeys(input: { workspaceId: unknown }): Promise<Row[]>;
  ownedLease(input: { workspaceId: unknown; repo: string; lease: string }): Promise<Row[]>;
  renewLockedLease(input: { workspaceId: unknown; repo: string }): Promise<void>;

  savePullRequest(
    input: {
      workspaceId: unknown;
      repo: string;
      number: number;
      issueIdentifier: string;
      title: string;
      url: string;
      headRef: string;
      state: string;
      updatedAt: string;
    },
  ): Promise<Row>;
  findIssue(input: { workspaceId: unknown; identifier: string }): Promise<Row[]>;
  markLinkback(
    input: { workspaceId: unknown; repo: string; number: number; issueIdentifier: string },
  ): Promise<void>;
  renewLease(input: { workspaceId: unknown; repo: string; lease: string }): Promise<Row[]>;
  advanceCursor(
    input: { newest: null | string; workspaceId: unknown; repo: string; lease: string },
  ): Promise<void>;
  releaseLease(input: { workspaceId: unknown; repo: string; lease: string }): Promise<void>;
}
