import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one, type Row, rows } from '../../../platform/database/query.ts';
import { visible } from '../../access/postgres.ts';
import { issueSelect } from '../../issues/postgres.ts';
import type { ActivityRepository } from '../application/repository.ts';
const actorJoin = sql`left join roster.users u on u.subject=a.actor_subject`;
const actorColumns = sql`u.name as actor_name,u.email as actor_email`;

export function createActivityRepository(db: Executor): ActivityRepository {
  return {
    async insertComment({ workspaceId, issueId, body, subject, author }) {
      return one(
        db,
        sql`insert into roster.comments(workspace_id,issue_id,body,actor_subject,author) values(${workspaceId},${issueId},${body},${subject},${author}) returning *`,
      );
    },
    async insertWorkLog({ workspaceId, issueId, kind, summary, body, subject }) {
      return one(
        db,
        sql`insert into roster.work_logs(workspace_id,issue_id,kind,summary,body,actor_subject) values(${workspaceId},${issueId},${kind},${summary},${body},${subject}) returning *`,
      );
    },
    async listWorkLogs({ workspaceId, issueId, hasKind, kind, hasCursor, before, limit }) {
      return rows(
        db,
        sql`select a.*,${actorColumns} from roster.work_logs a ${actorJoin} where a.workspace_id=${workspaceId} and a.issue_id=${issueId} ${
          hasKind ? sql`and a.kind=${kind}` : sql``
        } ${hasCursor ? sql`and a.id<${before}` : sql``} order by a.id desc limit ${limit}`,
      );
    },
    async findWorkLog({ workspaceId, issueId, id }) {
      return one(
        db,
        sql`select a.*,${actorColumns} from roster.work_logs a ${actorJoin} where a.workspace_id=${workspaceId} and a.issue_id=${issueId} and a.id=${id}`,
      );
    },
    async insertDelegation(
      { workspaceId, issueId, agent, session_id, agent_id, agent_type, hostname, subject },
    ) {
      await db.execute(
        sql`insert into roster.issue_delegations(workspace_id,issue_id,agent,session_id,agent_id,agent_type,hostname,actor_subject) values(${workspaceId},${issueId},${agent},${session_id},${agent_id},${agent_type},${hostname},${subject}) on conflict(issue_id,agent,session_id,agent_id,hostname) do nothing`,
      );
    },
    async findDelegation({ issueId, agent, session_id, agent_id, hostname }) {
      return one(
        db,
        sql`select a.*,${actorColumns} from roster.issue_delegations a ${actorJoin} where a.issue_id=${issueId} and a.agent=${agent} and a.session_id=${session_id} and a.agent_id=${agent_id} and a.hostname=${hostname}`,
      );
    },
    async insertLink({ workspaceId, issueId, title, url }) {
      await db.execute(
        sql`insert into roster.links(workspace_id,issue_id,title,url) values(${workspaceId},${issueId},${title},${url})`,
      );
    },
    async deleteRelation({ workspaceId, from, kind, to }) {
      await db.execute(
        sql`delete from roster.relations where workspace_id=${workspaceId} and issue_id=${from} and kind=${kind} and other_id=${to}`,
      );
    },
    async reachableRelation({ to, workspaceId, from }) {
      return rows(
        db,
        sql`with recursive reachable(id) as(select ${to}::uuid union select r.other_id from roster.relations r join reachable p on r.issue_id=p.id where r.workspace_id=${workspaceId} and r.kind='blocks') select 1 from reachable where id=${from}::uuid`,
      );
    },
    async insertRelation({ workspaceId, from, kind, to }) {
      await db.execute(
        sql`insert into roster.relations(workspace_id,issue_id,kind,other_id) values(${workspaceId},${from},${kind},${to}) on conflict do nothing`,
      );
    },
    async summary({ workspaceId, issueId, identifier }) {
      const actor = sql`to_jsonb(a)||jsonb_build_object('actor_name',u.name,'actor_email',u.email)`;
      const result = await one(
        db,
        sql`select
        (select coalesce(jsonb_agg(${actor} order by a.id),'[]'::jsonb) from roster.comments a ${actorJoin} where a.workspace_id=${workspaceId} and a.issue_id=${issueId}) as comments,
        (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from roster.links a where a.workspace_id=${workspaceId} and a.issue_id=${issueId}) as links,
        (select coalesce(jsonb_agg(${actor} order by a.id),'[]'::jsonb) from roster.issue_delegations a ${actorJoin} where a.workspace_id=${workspaceId} and a.issue_id=${issueId}) as delegations,
        (select coalesce(jsonb_agg(${actor} order by a.id desc),'[]'::jsonb) from roster.work_logs a ${actorJoin} where a.workspace_id=${workspaceId} and a.issue_id=${issueId} and a.kind='decision') as decisions,
        (select count(*) from roster.work_logs where workspace_id=${workspaceId} and issue_id=${issueId}) as work_log_count,
        (select coalesce(jsonb_agg(to_jsonb(a) order by a.updated_at desc),'[]'::jsonb) from roster.pull_requests a where a.workspace_id=${workspaceId} and a.issue_identifier=${identifier}) as pull_requests
      `,
      );
      // JSON timestamps/IDs are normalized by the same DTO mappers as direct pg rows.
      return {
        comments: result.comments as Row[],
        links: result.links as Row[],
        delegations: result.delegations as Row[],
        decisions: result.decisions as Row[],
        workLogCount: Number(result.work_log_count),
        pullRequests: result.pull_requests as Row[],
      };
    },
    async relatedIssues({ workspaceId, subject, issueId }) {
      return rows(
        db,
        sql`with edges as (
        select 'blocks' as direction,other_id as id from roster.relations where workspace_id=${workspaceId} and kind='blocks' and issue_id=${issueId}
        union select 'blocked_by',issue_id from roster.relations where workspace_id=${workspaceId} and kind='blocks' and other_id=${issueId}
        union select 'related',other_id from roster.relations where workspace_id=${workspaceId} and kind='related' and issue_id=${issueId}
        union select 'related',issue_id from roster.relations where workspace_id=${workspaceId} and kind='related' and other_id=${issueId}
      ), visible_issues as (
        ${issueSelect} where i.workspace_id=${workspaceId} and ${
          visible(subject)
        } and i.id in(select id from edges)
      ) select i.*,edges.direction from visible_issues i join edges on edges.id=i.id order by i.updated_at desc,i.id desc,edges.direction`,
      );
    },
  };
}
