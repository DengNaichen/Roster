import type { Row } from '../../../application/records.ts';
import type { Delivery, GitHubBinding, PullState, Scan } from './model.ts';
export interface Scope {
  workspaceId: string;
  repo: string;
  key: string;
  lease: string;
}
export interface SyncState {
  initializedAt: string | null;
  connectedAt: string;
  lastUpdatedAt: string | null;
  reconcileAfter: string;
  scan: Scan | null;
  blockedUntil: string | null;
}
export interface PendingDelivery {
  cutoff: string;
  number: number;
  attempts: number;
}
export interface PullLink {
  identifier: string;
  state: PullState;
  closes: boolean;
  observedLive: boolean;
  updatedAt: string;
}
export interface GitHubRepository {
  workspace(input: { workspace: string }): Promise<Row>;
  configure(input: { workspaceId: string; binding: GitHubBinding; key: string }): Promise<void>;
  claim(scope: Scope): Promise<SyncState | null>;
  owned(scope: Scope): Promise<boolean>;
  release(scope: Scope): Promise<void>;
  teamKeys(input: { workspaceId: string }): Promise<Row[]>;
  record(
    input: { workspaceId: string; repo: string; key: string; delivery: Delivery },
  ): Promise<void>;
  pending(scope: Scope, now: string): Promise<PendingDelivery[]>;
  attempt(scope: Scope, work: PendingDelivery): Promise<void>;
  finish(
    scope: Scope,
    work: PendingDelivery,
    outcome: 'applied' | 'ignored' | 'dead',
    error?: string,
  ): Promise<void>;
  retry(scope: Scope, work: PendingDelivery, at: string, error: string): Promise<void>;
  links(scope: Scope, number: number): Promise<PullLink[]>;
  removeLinks(scope: Scope, number: number): Promise<void>;
  savePullRequest(input: {
    scope: Scope;
    number: number;
    issueIdentifier: string;
    title: string;
    url: string;
    headRef: string;
    state: PullState;
    closes: boolean;
    observedLive: boolean;
    completionEligible: boolean;
    updatedAt: string;
  }): Promise<void>;
  findIssue(input: { workspaceId: string; identifier: string }): Promise<Row | null>;
  linkedPulls(
    input: { workspaceId: string; identifier: string },
  ): Promise<{ state: string; closes: boolean; completionEligible: boolean }[]>;
  checkpoint(scope: Scope, scan: Scan): Promise<void>;
  completeScan(scope: Scope, watermark: string | null, at: string, next: string): Promise<void>;
  failScan(scope: Scope, at: string, error: string): Promise<void>;
  pause(scope: Scope, at: string, error: string): Promise<void>;
}
