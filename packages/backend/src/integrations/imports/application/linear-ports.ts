import type { IssueDocument } from '../../../../../contracts/mod.ts';
import type { Row } from '../../../application/records.ts';
export type ImportResult<T = Row> = { rows: T[]; rowCount: number | null };
export interface LinearRepository {
  workspace(input: { slug: string }): Promise<ImportResult>;
  team(
    input: { workspaceId: unknown; key: string },
  ): Promise<ImportResult<{ id: unknown; next_number: number }>>;
  ensureIdentity(): Promise<ImportResult>;
  insertProject(
    input: { workspaceId: unknown; name: string; description: string; archived: boolean },
  ): Promise<ImportResult>;
  project(input: { workspaceId: unknown; name: string }): Promise<ImportResult>;
  linkProject(
    input: { workspaceId: unknown; projectId: unknown; teamId: unknown },
  ): Promise<ImportResult>;
  insertIssue(
    input: {
      workspaceId: unknown;
      teamId: unknown;
      number: number;
      identifier: string;
      title: string;
      document: IssueDocument;
      status: string;
      type: string | null;
      priority: number;
      projectId: unknown;
      createdAt: string;
      updatedAt: string;
    },
  ): Promise<ImportResult>;
  insertAudit(
    input: { workspaceId: unknown; issueId: unknown; snapshot: string; createdAt: string },
  ): Promise<ImportResult>;
  issue(input: { workspaceId: unknown; identifier: string }): Promise<ImportResult>;
  setParent(input: { parentId: string; issueId: string }): Promise<ImportResult>;
  insertRelation(
    input: { workspaceId: unknown; from: string; kind: string; to: string },
  ): Promise<ImportResult>;
  insertComment(
    input: {
      workspaceId: unknown;
      issueId: string;
      body: string;
      author: string;
      createdAt: string;
    },
  ): Promise<ImportResult>;
  insertLink(
    input: { workspaceId: unknown; issueId: string; title: string; url: string },
  ): Promise<ImportResult>;
}
export interface LinearStore {
  transaction<T>(run: (repository: LinearRepository) => Promise<T>): Promise<T>;
}
