import type { Row } from '../../../application/records.ts';
export interface ActivityRepository {
  insertComment(
    input: {
      workspaceId: unknown;
      issueId: unknown;
      body: string;
      subject: string;
      author: string;
    },
  ): Promise<Row>;
  insertWorkLog(
    input: {
      workspaceId: unknown;
      issueId: unknown;
      kind: string;
      summary: string;
      body: string;
      subject: string;
    },
  ): Promise<Row>;
  listWorkLogs(
    input: {
      workspaceId: unknown;
      issueId: unknown;
      hasKind: boolean;
      kind: string | undefined;
      hasCursor: boolean;
      before: number | undefined;
      limit: number;
    },
  ): Promise<Row[]>;
  findWorkLog(input: { workspaceId: unknown; issueId: unknown; id: number }): Promise<Row>;
  insertDelegation(
    input: {
      workspaceId: unknown;
      issueId: unknown;
      agent: string;
      session_id: string;
      agent_id: string;
      agent_type: string;
      hostname: string;
      subject: string;
    },
  ): Promise<void>;
  findDelegation(
    input: {
      issueId: unknown;
      agent: string;
      session_id: string;
      agent_id: string;
      hostname: string;
    },
  ): Promise<Row>;
  insertLink(
    input: { workspaceId: unknown; issueId: unknown; title: string; url: string },
  ): Promise<void>;
  deleteRelation(
    input: { workspaceId: unknown; from: string; kind: string; to: string },
  ): Promise<void>;
  reachableRelation(input: { to: string; workspaceId: unknown; from: string }): Promise<Row[]>;
  insertRelation(
    input: { workspaceId: unknown; from: string; kind: string; to: string },
  ): Promise<void>;
  comments(input: { workspaceId: unknown; issueId: string }): Promise<Row[]>;
  links(input: { workspaceId: unknown; issueId: string }): Promise<Row[]>;
  delegations(input: { workspaceId: unknown; issueId: string }): Promise<Row[]>;
  decisions(input: { workspaceId: unknown; issueId: string }): Promise<Row[]>;
  workLogCount(input: { workspaceId: unknown; issueId: string }): Promise<Row>;
  relatedIssues(
    input: {
      workspaceId: unknown;
      subject: string;
      incoming: boolean;
      relationKind: string;
      issueId: string;
      symmetric: boolean;
    },
  ): Promise<Row[]>;
  parentIdentifier(
    input: { workspaceId: unknown; parent_id: unknown; subject: string },
  ): Promise<Row[]>;
  pullRequests(input: { workspaceId: unknown; identifier: string }): Promise<Row[]>;
}
