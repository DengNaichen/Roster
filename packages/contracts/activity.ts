import { z } from 'zod';
import type { Identity, Issue, RequestContext } from './mod.ts';
const identifier = z.string().regex(/^[A-Z][A-Z0-9]{1,5}-[1-9][0-9]*$/);
const singleLine = (max: number, bytes = false) =>
  z.string().min(1).refine(
    (v) =>
      (bytes ? new TextEncoder().encode(v).length : Array.from(v).length) <= max &&
      v === v.trim() && !/[\p{Cc}]/u.test(v),
    'Must be a trimmed single line',
  );
const content = z.string().refine(
  (v) => v.trim().length > 0 && new TextEncoder().encode(v).length <= 65536,
  'Body must contain 1–65536 bytes',
);
export const addCommentSchema = z.strictObject({ identifier, body: content });
export const addWorkLogSchema = z.strictObject({
  identifier,
  kind: z.enum(['progress', 'decision']).default('progress'),
  summary: z.string().trim().pipe(singleLine(240)),
  body: content,
});
export const listWorkLogsSchema = z.strictObject({
  identifier,
  kind: z.enum(['progress', 'decision', '']).optional(),
  limit: z.number().int().min(0).max(100).optional(),
  before: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});
export const getWorkLogSchema = z.strictObject({
  identifier,
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const optionalLine = (max: number) => z.union([z.literal(''), singleLine(max, true)]).default('');
export const delegateIssueSchema = z.strictObject({
  identifier,
  client_context: z.strictObject({
    agent: z.enum(['codex', 'claude']),
    session_id: singleLine(256, true),
    agent_id: optionalLine(256),
    agent_type: optionalLine(128),
    hostname: singleLine(253, true),
  }),
});
export const addRelationSchema = z.strictObject({
  identifier,
  kind: z.enum(['blocks', 'blocked_by', 'related']),
  other: identifier,
  remove: z.boolean().default(false),
});
export const addLinkSchema = z.strictObject({
  identifier,
  title: z.string().trim().min(1).max(500),
  url: z.string().max(8192).url().refine((value) => {
    try {
      const u = new URL(value);
      return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password &&
        !/[\x00-\x20\x7f]/.test(value);
    } catch {
      return false;
    }
  }, 'An HTTP(S) URL without credentials is required'),
});
export type WorkLogSummary = {
  id: number;
  kind: 'progress' | 'decision';
  summary: string;
  actor: Identity | null;
  created_at: string;
};
export type WorkLog = WorkLogSummary & { body: string };
export type WorkLogPage = { work_logs: WorkLogSummary[]; next_before: number };
export type Comment = {
  id: number;
  body: string;
  author: string;
  actor: Identity | null;
  created_at: string;
};
export type Link = { title: string; url: string };
export type Delegation = {
  id: number;
  agent: 'codex' | 'claude';
  session_id: string;
  agent_id: string;
  agent_type: string;
  hostname: string;
  actor: Identity | null;
  created_at: string;
};
export type IssueActivity = {
  comments: Comment[];
  links: Link[];
  delegations: Delegation[];
  work_log_count: number;
  decisions: WorkLogSummary[];
  blocks: Issue[];
  blocked_by: Issue[];
  related: Issue[];
  pull_requests: {
    repo: string;
    number: number;
    title: string;
    url: string;
    state: string;
    updated_at: string;
  }[];
};
export interface ActivityService {
  addComment(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof addCommentSchema>,
  ): Promise<Comment>;
  addWorkLog(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof addWorkLogSchema>,
  ): Promise<WorkLog>;
  listWorkLogs(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof listWorkLogsSchema>,
  ): Promise<WorkLogPage>;
  getWorkLog(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof getWorkLogSchema>,
  ): Promise<WorkLog>;
  delegateIssue(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof delegateIssueSchema>,
  ): Promise<Delegation>;
  addRelation(
    ctx: RequestContext,
    slug: string,
    input: z.input<typeof addRelationSchema>,
  ): Promise<void>;
  addLink(ctx: RequestContext, slug: string, input: z.input<typeof addLinkSchema>): Promise<Link>;
}

export type ActivityIssueDetails = IssueActivity;
