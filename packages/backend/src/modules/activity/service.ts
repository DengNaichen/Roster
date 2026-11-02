import { sql } from 'npm:drizzle-orm@0.45.4';
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
} from '../../../../contracts/activity.ts';
import type { Identity, Issue, RequestContext } from '../../../../contracts/mod.ts';
import type { ActivityService } from '../../application/activity.ts';
import type { Database } from '../../platform/database/client.ts';
import { type Executor, one, type Row, rows } from '../../platform/database/query.ts';
import { fail } from '../../platform/errors/validation.ts';
import { iso } from '../../platform/time.ts';
import { saveIdentity, visible, workspace } from '../access/index.ts';
import { audit } from '../audit/index.ts';
import { hydrateIssueCatalog, issueDTO, issueSelect, readIssue } from '../issues/index.ts';
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
const actorJoin = sql`left join roster.users u on u.subject=a.actor_subject`;
const actorColumns = sql`u.name as actor_name,u.email as actor_email`;
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
async function scope(db: Executor, ctx: RequestContext, slug: string, id: string, lock = false) {
  const w = await workspace(db, ctx, slug, lock);
  const issue = await readIssue(db, ctx, w, id);
  return { w, issue };
}
export function createActivityService(db: Database): ActivityService {
  return {
    async addComment(ctx, slug, input) {
      const i = parse(addCommentSchema, input);
      return db.transaction(async (tx) => {
        const { w, issue } = await scope(tx, ctx, slug, i.identifier, true);
        await saveIdentity(tx, ctx);
        const author = ctx.identity.name || ctx.identity.email || ctx.identity.subject;
        const row = await one(
          tx,
          sql`insert into roster.comments(workspace_id,issue_id,body,actor_subject,author) values(${w.id},${issue.id},${i.body},${ctx.identity.subject},${author}) returning *`,
        );
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
        const row = await one(
          tx,
          sql`insert into roster.work_logs(workspace_id,issue_id,kind,summary,body,actor_subject) values(${w.id},${issue.id},${i.kind},${i.summary},${i.body},${ctx.identity.subject}) returning *`,
        );
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
      const result = (await rows(
        db,
        sql`select a.*,${actorColumns} from roster.work_logs a ${actorJoin} where a.workspace_id=${w.id} and a.issue_id=${issue.id} ${
          i.kind ? sql`and a.kind=${i.kind}` : sql``
        } ${i.before ? sql`and a.id<${i.before}` : sql``} order by a.id desc limit ${limit + 1}`,
      )).map(logDTO);
      return {
        work_logs: result.slice(0, limit),
        next_before: result.length > limit ? result[limit - 1].id : 0,
      };
    },
    async getWorkLog(ctx, slug, input) {
      const i = parse(getWorkLogSchema, input);
      const { w, issue } = await scope(db, ctx, slug, i.identifier);
      const row = await one(
        db,
        sql`select a.*,${actorColumns} from roster.work_logs a ${actorJoin} where a.workspace_id=${w.id} and a.issue_id=${issue.id} and a.id=${i.id}`,
      );
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
        await tx.execute(
          sql`insert into roster.issue_delegations(workspace_id,issue_id,agent,session_id,agent_id,agent_type,hostname,actor_subject) values(${w.id},${issue.id},${c.agent},${c.session_id},${c.agent_id},${c.agent_type},${c.hostname},${ctx.identity.subject}) on conflict(issue_id,agent,session_id,agent_id,hostname) do nothing`,
        );
        if (issue.status !== 'in_progress') {
          const after = await one(
            tx,
            sql`update roster.issues set status='in_progress',updated_at=clock_timestamp() where id=${issue.id} returning *`,
          );
          await audit(tx, ctx, w, 'issue.updated', issue, after, String(issue.id));
        }
        const row = await one(
          tx,
          sql`select a.*,${actorColumns} from roster.issue_delegations a ${actorJoin} where a.issue_id=${issue.id} and a.agent=${c.agent} and a.session_id=${c.session_id} and a.agent_id=${c.agent_id} and a.hostname=${c.hostname}`,
        );
        return delegationDTO(row);
      });
    },
    async addLink(ctx, slug, input) {
      const i = parse(addLinkSchema, input);
      return db.transaction(async (tx) => {
        const { w, issue } = await scope(tx, ctx, slug, i.identifier, true);
        await tx.execute(
          sql`insert into roster.links(workspace_id,issue_id,title,url) values(${w.id},${issue.id},${i.title},${i.url})`,
        );
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
          await tx.execute(
            sql`delete from roster.relations where workspace_id=${w.id} and issue_id=${from} and kind=${kind} and other_id=${to}`,
          );
          return;
        }
        if (kind === 'blocks') {
          const reachable = await rows(
            tx,
            sql`with recursive reachable(id) as(select ${to}::uuid union select r.other_id from roster.relations r join reachable p on r.issue_id=p.id where r.workspace_id=${w.id} and r.kind='blocks') select 1 from reachable where id=${from}::uuid`,
          );
          if (reachable.length) fail('invalid_input', 'Dependency cycle is not allowed');
        }
        await tx.execute(
          sql`insert into roster.relations(workspace_id,issue_id,kind,other_id) values(${w.id},${from},${kind},${to}) on conflict do nothing`,
        );
      });
    },
  };
}
/** Caller passes workspace and issue already checked by readIssue, never user input IDs. */
export async function hydrateIssueActivity<T extends Issue>(
  db: Executor,
  ctx: RequestContext,
  w: Row,
  issue: T,
): Promise<T & IssueActivity> {
  await readIssue(db, ctx, w, issue.identifier);
  const comments = (await rows(
    db,
    sql`select a.*,${actorColumns} from roster.comments a ${actorJoin} where a.workspace_id=${w.id} and a.issue_id=${issue.id} order by a.id`,
  )).map(commentDTO);
  const links = (await rows(
    db,
    sql`select title,url from roster.links where workspace_id=${w.id} and issue_id=${issue.id} order by id`,
  )).map((r) => ({ title: String(r.title), url: String(r.url) }));
  const delegations = (await rows(
    db,
    sql`select a.*,${actorColumns} from roster.issue_delegations a ${actorJoin} where a.workspace_id=${w.id} and a.issue_id=${issue.id} order by a.id`,
  )).map(delegationDTO);
  const decisions = (await rows(
    db,
    sql`select a.*,${actorColumns} from roster.work_logs a ${actorJoin} where a.workspace_id=${w.id} and a.issue_id=${issue.id} and a.kind='decision' order by a.id desc`,
  )).map(logDTO);
  const count = await one(
    db,
    sql`select count(*) as count from roster.work_logs where workspace_id=${w.id} and issue_id=${issue.id}`,
  );
  const relationIssues = async (kind: 'blocks' | 'blocked_by' | 'related') => {
    const rs = await rows(
      db,
      sql`${issueSelect} where i.workspace_id=${w.id} and ${
        visible(ctx.identity.subject)
      } and i.id in(select ${
        kind === 'blocked_by' ? sql`r.issue_id` : sql`r.other_id`
      } from roster.relations r where r.workspace_id=${w.id} and r.kind=${
        kind === 'related' ? 'related' : 'blocks'
      } and ${kind === 'blocked_by' ? sql`r.other_id` : sql`r.issue_id`}=${issue.id} ${
        kind === 'related'
          ? sql`union select r.issue_id from roster.relations r where r.workspace_id=${w.id} and r.kind='related' and r.other_id=${issue.id}`
          : sql``
      }) order by i.updated_at desc,i.id desc`,
    );
    const hydrated = await hydrateIssueCatalog(db, ctx, String(w.id), rs);
    return await Promise.all(hydrated.map(async (row) => {
      let parent: string | null = null;
      if (row.parent_id) {
        const p = (await rows(
          db,
          sql`select i.identifier from roster.issues i join roster.teams t on t.id=i.team_id where i.workspace_id=${w.id} and i.id=${row.parent_id} and ${
            visible(ctx.identity.subject)
          }`,
        ))[0];
        parent = p ? String(p.identifier) : null;
      }
      return issueDTO({ ...row, parent });
    }));
  };
  const pull_requests = (await rows(
    db,
    sql`select repo,number,title,url,state,updated_at from roster.pull_requests where workspace_id=${w.id} and issue_identifier=${issue.identifier} order by updated_at desc`,
  )).map((r) => ({
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
