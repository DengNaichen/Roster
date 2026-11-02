import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one, rows } from '../../../platform/database/query.ts';
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
    async comments({ workspaceId, issueId }) {
      return rows(
        db,
        sql`select a.*,${actorColumns} from roster.comments a ${actorJoin} where a.workspace_id=${workspaceId} and a.issue_id=${issueId} order by a.id`,
      );
    },
    async links({ workspaceId, issueId }) {
      return rows(
        db,
        sql`select title,url from roster.links where workspace_id=${workspaceId} and issue_id=${issueId} order by id`,
      );
    },
    async delegations({ workspaceId, issueId }) {
      return rows(
        db,
        sql`select a.*,${actorColumns} from roster.issue_delegations a ${actorJoin} where a.workspace_id=${workspaceId} and a.issue_id=${issueId} order by a.id`,
      );
    },
    async decisions({ workspaceId, issueId }) {
      return rows(
        db,
        sql`select a.*,${actorColumns} from roster.work_logs a ${actorJoin} where a.workspace_id=${workspaceId} and a.issue_id=${issueId} and a.kind='decision' order by a.id desc`,
      );
    },
    async workLogCount({ workspaceId, issueId }) {
      return one(
        db,
        sql`select count(*) as count from roster.work_logs where workspace_id=${workspaceId} and issue_id=${issueId}`,
      );
    },
    async relatedIssues(
      {
        workspaceId,
        subject,
        incoming,
        relationKind,
        issueId,
        symmetric,
      },
    ) {
      return rows(
        db,
        sql`${issueSelect} where i.workspace_id=${workspaceId} and ${
          visible(subject)
        } and i.id in(select ${
          incoming ? sql`r.issue_id` : sql`r.other_id`
        } from roster.relations r where r.workspace_id=${workspaceId} and r.kind=${relationKind} and ${
          incoming ? sql`r.other_id` : sql`r.issue_id`
        }=${issueId} ${
          symmetric
            ? sql`union select r.issue_id from roster.relations r where r.workspace_id=${workspaceId} and r.kind='related' and r.other_id=${issueId}`
            : sql``
        }) order by i.updated_at desc,i.id desc`,
      );
    },
    async parentIdentifier({ workspaceId, parent_id, subject }) {
      return rows(
        db,
        sql`select i.identifier from roster.issues i join roster.teams t on t.id=i.team_id where i.workspace_id=${workspaceId} and i.id=${parent_id} and ${
          visible(subject)
        }`,
      );
    },
    async pullRequests({ workspaceId, identifier }) {
      return rows(
        db,
        sql`select repo,number,title,url,state,updated_at from roster.pull_requests where workspace_id=${workspaceId} and issue_identifier=${identifier} order by updated_at desc`,
      );
    },
  };
}
