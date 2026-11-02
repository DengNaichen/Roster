import type { Row } from '../../../application/records.ts';
export interface SnapshotRepository {
  lock(): Promise<void>;
  hasWorkspaces(): Promise<boolean>;
  insert(table: string, row: Row): Promise<void>;
  ensureSystemIdentity(): Promise<void>;
  setParent(parentId: string, issueId: string): Promise<void>;
  ensureOwner(subject: string, name: string, email: string): Promise<void>;
  ensureAdministrator(workspaceId: string, subject: string): Promise<void>;
  inaccessibleWorkspaces(): Promise<boolean>;
  collidingNumbers(): Promise<boolean>;
  advanceSequences(): Promise<void>;
}
export interface SnapshotStore {
  transaction<T>(run: (repository: SnapshotRepository) => Promise<T>): Promise<T>;
}
