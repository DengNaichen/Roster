import type { Row } from '../../../application/records.ts';
export interface LabelsRepository {
  findLabel(input: { workspaceId: unknown; id: number }): Promise<Row[]>;
  listLabels(input: { workspaceId: unknown; include_archived: boolean }): Promise<Row[]>;
  listGroups(input: { workspaceId: unknown }): Promise<Row[]>;
  insertGroup(input: { workspaceId: unknown; name: string; toLowerCase: string }): Promise<Row>;
  renameGroup(
    input: { name: string; toLowerCase: string; workspaceId: unknown; id: number },
  ): Promise<Row>;
  findGroup(input: { workspaceId: unknown; group_id: number }): Promise<Row[]>;
  insertLabel(
    input: {
      workspaceId: unknown;
      name: string;
      toLowerCase: string;
      color: string;
      description: string;
      group_id: null | number;
    },
  ): Promise<Row>;
  updateLabel(
    input: {
      name: string;
      toLowerCase: string;
      color: unknown;
      description: unknown;
      archived: unknown;
      workspaceId: unknown;
      id: number;
    },
  ): Promise<Row>;
  removeIssueLabel(input: { issueId: unknown; id: number }): Promise<Row[]>;
  findIssueLabel(input: { issueId: unknown; id: unknown }): Promise<Row[]>;
  clearExclusiveLabel(input: { issueId: unknown; group_id: undefined | unknown }): Promise<void>;
  addIssueLabel(input: { workspaceId: unknown; issueId: unknown; id: unknown }): Promise<void>;
  hasHiddenIssues(input: { id: unknown; subject: string }): Promise<Row[]>;
  labelIssueIds(input: { id: unknown }): Promise<Row[]>;
  clearLabel(input: { id: unknown }): Promise<void>;
  transferLabel(input: { workspaceId: unknown; issueId: unknown; id: unknown }): Promise<void>;
  deleteLabel(input: { workspaceId: unknown; id: unknown }): Promise<void>;
}
