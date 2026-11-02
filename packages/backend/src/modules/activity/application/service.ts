import { z } from 'zod';
import {
  addCommentSchema,
  addLinkSchema,
  addRelationSchema,
  addWorkLogSchema,
  type Comment,
  delegateIssueSchema,
  type Delegation,
  getWorkLogSchema,
  type IssueActivity,
  listWorkLogsSchema,
  type WorkLogSummary,
} from '../../../../../contracts/activity.ts';
import type { Identity, Issue, RequestContext } from '../../../../../contracts/mod.ts';
import type { ActivityService } from '../../../application/activity.ts';
import type { Row } from '../../../application/records.ts';
import type { Session, UnitOfWork } from '../../../application/session.ts';
import { startDelegatedIssue } from '../../issues/index.ts';

import { fail } from '../../../platform/errors/validation.ts';
import { iso } from '../../../platform/time.ts';
import { saveIdentity, workspace } from '../../access/index.ts';
import { hydrateIssueCatalog, issueDTO, readIssue } from '../../issues/index.ts';
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  return r.success
    ? r.data
    : fail('invalid_input', r.error.issues.map((i) => i.message).join('; '));
}
function actor(row: Row): Identity | null {
  return row.actor_subject
    ? {
      subject: String(row.actor_subject),
      name: String(row.actor_name ?? ''),
      email: String(row.actor_email ?? ''),
    }
    : null;
}

function logDTO(r: Row): WorkLogSummary {
  return {
    id: Number(r.id),
    kind: r.kind as WorkLogSummary['kind'],
    summary: String(r.summary),
    actor: actor(r),
    created_at: iso(r.created_at),
  };
}
function delegationDTO(r: Row): Delegation {
  return {
    id: Number(r.id),
    agent: r.agent as Delegation['agent'],
    session_id: String(r.session_id),
    agent_id: String(r.agent_id),
    agent_type: String(r.agent_type),
    hostname: String(r.hostname),
    actor: actor(r),
    created_at: iso(r.created_at),
  };
}
function commentDTO(r: Row): Comment {
  return {
    id: Number(r.id),
    body: String(r.body),
    author: String(r.author),
    actor: actor(r),
    created_at: iso(r.created_at),
  };
}
async function scope(db: Session, ctx: RequestContext, slug: string, id: string, lock = false) {
  const w = await workspace(db, ctx, slug, lock);
  const issue = await readIssue(db, ctx, w, id);
  return { w, issue };
}
export function createActivityService(db: UnitOfWork): ActivityService {
  return {
    async addComment(ctx, slug, input) {
      const i = parse(addCommentSchema, input);
      return db.transaction(async (tx) => {
        const { w, issue } = await scope(tx, ctx, slug, i.identifier, true);
        await saveIdentity(tx, ctx);
        const author = ctx.identity.name || ctx.identity.email || ctx.identity.subject;
        const row = await tx.activity.insertComment({
          workspaceId: w.id,
          issueId: issue.id,
          body: i.body,
          subject: ctx.identity.subject,
          author,
        });
        return commentDTO({
          ...row,
          actor_name: ctx.identity.name,
          actor_email: ctx.identity.email,
        });
      });
    },
    async addWorkLog(ctx, slug, input) {
      const i = parse(addWorkLogSchema, input);
      return db.transaction(async (tx) => {
        const { w, issue } = await scope(tx, ctx, slug, i.identifier, true);
        await saveIdentity(tx, ctx);
        const row = await tx.activity.insertWorkLog({
          workspaceId: w.id,
          issueId: issue.id,
          kind: i.kind,
          summary: i.summary,
          body: i.body,
          subject: ctx.identity.subject,
        });
        return {
          ...logDTO({ ...row, actor_name: ctx.identity.name, actor_email: ctx.identity.email }),
          body: String(row.body),
        };
      });
    },
    async listWorkLogs(ctx, slug, input) {
      const i = parse(listWorkLogsSchema, input);
      const { w, issue } = await scope(db, ctx, slug, i.identifier);
      const limit = i.limit || 20;
      const result = (await db.activity.listWorkLogs({
        workspaceId: w.id,
        issueId: issue.id,
        hasKind: Boolean(i.kind),
        kind: (i.kind) ? (i.kind) : undefined,
        hasCursor: Boolean(i.before),
        before: (i.before) ? (i.before) : undefined,
        limit: limit + 1,
      })).map(logDTO);
      return {
        work_logs: result.slice(0, limit),
        next_before: result.length > limit ? result[limit - 1].id : 0,
      };
    },
    async getWorkLog(ctx, slug, input) {
      const i = parse(getWorkLogSchema, input);
      const { w, issue } = await scope(db, ctx, slug, i.identifier);
      const row = await db.activity.findWorkLog({ workspaceId: w.id, issueId: issue.id, id: i.id });
      return { ...logDTO(row), body: String(row.body) };
    },
    async delegateIssue(ctx, slug, input) {
      const i = parse(delegateIssueSchema, input);
      return db.transaction(async (tx) => {
        const { w, issue } = await scope(tx, ctx, slug, i.identifier, true);
        if (!issue.assignee_subject) {
          fail('invalid_input', 'Assign a human assignee before delegating this issue');
        }
        await saveIdentity(tx, ctx);
        const c = i.client_context;
        await tx.activity.insertDelegation({
          workspaceId: w.id,
          issueId: issue.id,
          agent: c.agent,
          session_id: c.session_id,
          agent_id: c.agent_id,
          agent_type: c.agent_type,
          hostname: c.hostname,
          subject: ctx.identity.subject,
        });
        await startDelegatedIssue(tx, ctx, w, issue);
        const row = await tx.activity.findDelegation({
          issueId: issue.id,
          agent: c.agent,
          session_id: c.session_id,
          agent_id: c.agent_id,
          hostname: c.hostname,
        });
        return delegationDTO(row);
      });
    },
    async addLink(ctx, slug, input) {
      const i = parse(addLinkSchema, input);
      return db.transaction(async (tx) => {
        const { w, issue } = await scope(tx, ctx, slug, i.identifier, true);
        await tx.activity.insertLink({
          workspaceId: w.id,
          issueId: issue.id,
          title: i.title,
          url: i.url,
        });
        return { title: i.title, url: i.url };
      });
    },
    async addRelation(ctx, slug, input) {
      const i = parse(addRelationSchema, input);
      await db.transaction(async (tx) => {
        const { w, issue } = await scope(tx, ctx, slug, i.identifier, true);
        const other = await readIssue(tx, ctx, w, i.other);
        let from = String(issue.id), to = String(other.id), kind = i.kind;
        if (from === to) fail('invalid_input', 'Self relations are not allowed');
        if (kind === 'blocked_by') {
          [from, to] = [to, from];
          kind = 'blocks';
        }
        if (kind === 'related' && from > to) [from, to] = [to, from];
        if (i.remove) {
          await tx.activity.deleteRelation({ workspaceId: w.id, from, kind, to });
          return;
        }
        if (kind === 'blocks') {
          const reachable = await tx.activity.reachableRelation({ to, workspaceId: w.id, from });
          if (reachable.length) fail('invalid_input', 'Dependency cycle is not allowed');
        }
        await tx.activity.insertRelation({ workspaceId: w.id, from, kind, to });
      });
    },
  };
}
/** Caller passes workspace and issue already checked by readIssue, never user input IDs. */
export async function hydrateIssueActivity<T extends Issue>(
  db: Session,
  ctx: RequestContext,
  w: Row,
  issue: T,
): Promise<T & IssueActivity> {
  await readIssue(db, ctx, w, issue.identifier);
  const comments = (await db.activity.comments({ workspaceId: w.id, issueId: issue.id })).map(
    commentDTO,
  );
  const links = (await db.activity.links({ workspaceId: w.id, issueId: issue.id })).map((r) => ({
    title: String(r.title),
    url: String(r.url),
  }));
  const delegations = (await db.activity.delegations({ workspaceId: w.id, issueId: issue.id })).map(
    delegationDTO,
  );
  const decisions = (await db.activity.decisions({ workspaceId: w.id, issueId: issue.id })).map(
    logDTO,
  );
  const count = await db.activity.workLogCount({ workspaceId: w.id, issueId: issue.id });
  const relationIssues = async (kind: 'blocks' | 'blocked_by' | 'related') => {
    const rs = await db.activity.relatedIssues({
      workspaceId: w.id,
      subject: ctx.identity.subject,
      incoming: Boolean(kind === 'blocked_by'),
      relationKind: kind === 'related' ? 'related' : 'blocks',
      issueId: issue.id,
      symmetric: Boolean(kind === 'related'),
    });
    const hydrated = await hydrateIssueCatalog(db, ctx, String(w.id), rs);
    return await Promise.all(hydrated.map(async (row) => {
      let parent: string | null = null;
      if (row.parent_id) {
        const p = (await db.activity.parentIdentifier({
          workspaceId: w.id,
          parent_id: row.parent_id,
          subject: ctx.identity.subject,
        }))[0];
        parent = p ? String(p.identifier) : null;
      }
      return issueDTO({ ...row, parent });
    }));
  };
  const pull_requests =
    (await db.activity.pullRequests({ workspaceId: w.id, identifier: issue.identifier })).map((
      r,
    ) => ({
      repo: String(r.repo),
      number: Number(r.number),
      title: String(r.title),
      url: String(r.url),
      state: String(r.state),
      updated_at: iso(r.updated_at),
    }));
  return {
    ...issue,
    comments,
    links,
    delegations,
    decisions,
    work_log_count: Number(count.count),
    blocks: await relationIssues('blocks'),
    blocked_by: await relationIssues('blocked_by'),
    related: await relationIssues('related'),
    pull_requests,
  };
}
