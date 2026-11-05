import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one, rows } from '../../../platform/database/query.ts';
import { visible } from '../../access/postgres.ts';
import type { SpecsRepository } from '../application/repository.ts';
const revisionColumns =
  sql`r.number,r.message,r.created_at,r.content,u.subject as author_subject,u.name as author_name,u.email as author_email`;
const revisionFrom =
  sql`from roster.spec_revisions r left join roster.users u on u.subject=r.author_subject`;

// The inner t is the issue team: linked private issues must not leak through counts.
function progress(subject: string) {
  return sql`cross join lateral (select count(*)::int as total,
    (count(*) filter (where i.status='done'))::int as done
    from roster.spec_issues link join roster.issues i on i.id=link.issue_id
    join roster.teams t on t.id=i.team_id
    where link.workspace_id=sp.workspace_id and link.spec_id=sp.id and ${
    visible(subject)
  }) progress`;
}

// The most recent adoption is still in effect while a newer revision is under review.
// A historical supersession cancels earlier adoptions instead of reviving them.
const activeRevision = sql`left join lateral (
  select a.number, a.content->>'title' as title, a.content->>'status' as status
  from roster.spec_revisions a where a.spec_id=sp.id and a.number <= sp.current_revision
    and a.content->>'status' in ('active','approved','superseded')
  order by a.number desc limit 1
) adopted on adopted.status in ('active','approved')`;
const activeFields = sql`adopted.number as active_number,adopted.title as active_title`;

export function createSpecsRepository(db: Executor): SpecsRepository {
  return {
    dependencies({ workspaceId, specId, subject }) {
      return one(
        db,
        sql`with recursive
        visible_issues as materialized (
          select i.id,i.identifier,i.title,i.status,i.assignee_subject from roster.issues i
          join roster.teams t on t.id=i.team_id
          where i.workspace_id=${workspaceId} and ${visible(subject)}
        ),
        links as (select v.id from visible_issues v join roster.spec_issues s on s.issue_id=v.id where s.spec_id=${specId}),
        visible_edges as materialized (
          select r.issue_id as source,r.other_id as target from roster.relations r
          join visible_issues a on a.id=r.issue_id join visible_issues b on b.id=r.other_id
          where r.workspace_id=${workspaceId} and r.kind='blocks'
        ),
        ancestors(id) as (
          select id from links
          union
          select e.source from visible_edges e join ancestors a on a.id=e.target
        )
        select
          coalesce((select json_agg(json_build_object(
            'id',v.id,'identifier',v.identifier,'title',v.title,'status',v.status,
            'external',not exists(select 1 from links l where l.id=v.id),
            'assignee',case when u.subject is null then null else json_build_object('subject',u.subject,'name',u.name,'email',u.email) end
          ) order by v.identifier) from ancestors a join visible_issues v on v.id=a.id left join roster.users u on u.subject=v.assignee_subject),'[]'::json) as nodes,
          coalesce((select json_agg(json_build_object('from',e.source,'to',e.target) order by e.source,e.target)
          from visible_edges e join ancestors a on a.id=e.source join ancestors b on b.id=e.target),'[]'::json) as edges`,
      );
    },
    getDesign(specId) {
      return rows(
        db,
        sql`select revision,spec_revision,content from roster.spec_designs where spec_id=${specId}`,
      );
    },
    saveDesign({ specId, base, specRevision, content, subject, now }) {
      const query = base === 0
        ? sql`insert into roster.spec_designs(spec_id,revision,spec_revision,content,updated_by,updated_at)
                values (${specId},1,${specRevision},${content}::json,${subject},${now}) on conflict(spec_id) do nothing`
        : sql`update roster.spec_designs set revision=revision+1,spec_revision=${specRevision},content=${content}::json,updated_by=${subject},updated_at=${now}
              where spec_id=${specId} and revision=${base}`;
      return rows(db, sql`${query} returning revision,spec_revision,content`);
    },
    async linkIssues({ workspaceId, specId, issueIds, subject, now }) {
      await db.execute(
        sql`insert into roster.spec_issues(workspace_id,spec_id,issue_id,created_by,created_at) values ${
          sql.join(
            issueIds.map((issueId) =>
              sql`(${workspaceId},${specId},${issueId}::uuid,${subject},${now})`
            ),
            sql`,`,
          )
        } on conflict(spec_id,issue_id) do nothing`,
      );
    },
    async unlinkIssues({ specId, issueIds }) {
      await db.execute(
        sql`delete from roster.spec_issues where spec_id=${specId} and issue_id in (${
          sql.join(issueIds.map((id) => sql`${id}::uuid`), sql`,`)
        })`,
      );
    },
    async listIssueSpecs({ workspaceId, issueId, subject }) {
      return rows(
        db,
        sql`select sp.number,t.key as team,r.content->>'title' as title,r.content->>'status' as status,sp.current_revision,sp.updated_at,progress.total,progress.done,${activeFields} from roster.spec_issues si join roster.specs sp on sp.id=si.spec_id join roster.teams t on t.id=sp.team_id join roster.spec_revisions r on r.spec_id=sp.id and r.number=sp.current_revision ${
          progress(subject)
        } ${activeRevision} where si.workspace_id=${workspaceId} and si.issue_id=${issueId}::uuid and ${
          visible(subject)
        } order by sp.updated_at desc,sp.id desc`,
      );
    },
    async findSpec({ workspaceId, number, subject }) {
      return one(
        db,
        sql`select sp.*,t.key as team,progress.total,progress.done,${activeFields} from roster.specs sp join roster.teams t on t.id=sp.team_id ${
          progress(subject)
        } ${activeRevision} where sp.workspace_id=${workspaceId} and sp.number=${number} and ${
          visible(subject)
        }`,
      );
    },
    async currentRevision({ specId, current_revision }) {
      return one(
        db,
        sql`select ${revisionColumns} ${revisionFrom} where r.spec_id=${specId} and r.number=${current_revision}`,
      );
    },
    async listSpecs({ workspaceId, subject, hasTeam, teamId }) {
      return rows(
        db,
        sql`select sp.number,t.key as team,r.content->>'title' as title,r.content->>'status' as status,sp.current_revision,sp.updated_at,progress.total,progress.done,${activeFields} from roster.specs sp join roster.teams t on t.id=sp.team_id join roster.spec_revisions r on r.spec_id=sp.id and r.number=sp.current_revision ${
          progress(subject)
        } ${activeRevision} where sp.workspace_id=${workspaceId} and ${visible(subject)} ${
          hasTeam ? sql`and sp.team_id=${teamId}` : sql``
        } order by sp.updated_at desc,sp.id desc`,
      );
    },
    async nextNumber({ workspaceId }) {
      return one(
        db,
        sql`select coalesce(max(number),0)+1 as number from roster.specs where workspace_id=${workspaceId}`,
      );
    },
    async insertSpec({ workspaceId, teamId, number, now }) {
      return one(
        db,
        sql`insert into roster.specs(workspace_id,team_id,number,current_revision,created_at,updated_at) values(${workspaceId},${teamId},${number},1,${now},${now}) returning id`,
      );
    },
    async insertFirstRevision({ specId, content, message, subject, now }) {
      await db.execute(
        sql`insert into roster.spec_revisions(spec_id,number,content,message,author_subject,created_at) values(${specId},1,${content}::json,${message},${subject},${now})`,
      );
    },
    async revisionHistory({ specId }) {
      return rows(
        db,
        sql`select number,content from roster.spec_revisions where spec_id=${specId}`,
      );
    },
    async advanceRevision({ next, now, specId, base_revision }) {
      return rows(
        db,
        sql`update roster.specs set current_revision=${next},updated_at=${now} where id=${specId} and current_revision=${base_revision} returning id`,
      );
    },
    async insertRevision({ specId, next, content, message, subject, now }) {
      await db.execute(
        sql`insert into roster.spec_revisions(spec_id,number,content,message,author_subject,created_at) values(${specId},${next},${content}::json,${message},${subject},${now})`,
      );
    },
    async listRevisions({ specId }) {
      return rows(
        db,
        sql`select ${revisionColumns} ${revisionFrom} where r.spec_id=${specId} order by r.number desc`,
      );
    },
    async findRevision({ specId, number }) {
      return one(
        db,
        sql`select ${revisionColumns} ${revisionFrom} where r.spec_id=${specId} and r.number=${number}`,
      );
    },
  };
}
