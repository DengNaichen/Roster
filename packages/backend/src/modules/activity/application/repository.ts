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
  summary(input: { workspaceId: unknown; issueId: string; identifier: string }): Promise<{
    comments: Row[];
    links: Row[];
    delegations: Row[];
    decisions: Row[];
    workLogCount: number;
    pullRequests: Row[];
  }>;
  relatedIssues(input: { workspaceId: unknown; subject: string; issueId: string }): Promise<Row[]>;
}
