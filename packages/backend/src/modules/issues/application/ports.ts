import type {
  CreateIssueInput,
  Issue,
  IssueDetail,
  IssueDocument,
  IssuePage,
  ListIssuesInput,
  RequestContext,
  UpdateIssueInput,
} from '../../../../../contracts/mod.ts';

export type WorkspaceScope = { id: string };
export type TeamScope = { id: string; private: boolean };
/** Storage-independent snapshot; additional fields are retained for audit history. */
export type StoredIssue = Record<string, unknown> & { id: string; identifier: string };
export type IssueSnapshot = StoredIssue & {
  id: string;
  identifier: string;
  team: string;
  project_id: number | null;
  cycle_id: number | null;
  parent_id: string | null;
  assignee_subject: string | null;
};
export type IssueReferences = {
  assignee: string | null;
  project: number | null;
  cycle: number | null;
  parent: string | null;
};
export interface IssueSession {
  workspace(ctx: RequestContext, slug: string): Promise<WorkspaceScope>;
  team(ctx: RequestContext, w: WorkspaceScope, key: string): Promise<TeamScope>;
  read(ctx: RequestContext, w: WorkspaceScope, id: string): Promise<IssueSnapshot>;
  assignee(
    w: WorkspaceScope,
    t: TeamScope,
    subject: string | null | undefined,
  ): Promise<string | null>;
  project(
    ctx: RequestContext,
    w: WorkspaceScope,
    t: TeamScope,
    input: UpdateIssueInput,
    current: number | null,
  ): Promise<number | null>;
  cycle(
    t: TeamScope,
    input: number | undefined,
    current: number | null,
    now: Date,
  ): Promise<number | null>;
  parent(
    ctx: RequestContext,
    w: WorkspaceScope,
    input: string | undefined,
    current: IssueSnapshot | null,
  ): Promise<string | null>;
  nextNumber(t: TeamScope): Promise<number>;
  insert(
    w: WorkspaceScope,
    t: TeamScope,
    number: number,
    input: CreateIssueInput,
    refs: IssueReferences,
  ): Promise<StoredIssue>;
  update(current: IssueSnapshot, input: UpdateIssueInput, refs: IssueReferences): Promise<void>;
  /** Locks the issue row until the transaction ends. */
  lockDocument(issue: IssueSnapshot): Promise<IssueDocument>;
  writeDocument(issue: IssueSnapshot, document: IssueDocument): Promise<void>;
  audit(
    ctx: RequestContext,
    w: WorkspaceScope,
    kind: string,
    issueId: string,
    before: unknown,
    after: unknown,
  ): Promise<void>;
  output(ctx: RequestContext, w: WorkspaceScope, issue: IssueSnapshot): Promise<Issue>;
}
export interface IssueDependencies {
  transaction<T>(run: (session: IssueSession) => Promise<T>): Promise<T>;
  listIssues(ctx: RequestContext, slug: string, input?: ListIssuesInput): Promise<IssuePage>;
  getIssue(ctx: RequestContext, slug: string, identifier: string): Promise<IssueDetail>;
}
