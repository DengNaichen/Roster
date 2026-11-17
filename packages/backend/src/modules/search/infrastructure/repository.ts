import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, rows } from '../../../platform/database/query.ts';
import { iso } from '../../../platform/time.ts';
import { visible } from '../../access/postgres.ts';
import { visibleProject } from '../../planning/postgres.ts';
import type { SearchRepository, SearchRow } from '../application/repository.ts';
export function createSearchRepository(db: Executor): SearchRepository {
  return {
    async search({ workspaceId, subject, query, type, limit, after }) {
      const q = query.toLowerCase();
      const result = await rows(
        db,
        sql`
        with candidates as (
          select 'issue'::text as type,i.id::text as id,i.identifier as identifier,i.title,i.document_text as body,i.updated_at
          from roster.issues i join roster.teams t on t.id=i.team_id
          where i.workspace_id=${workspaceId} and ${visible(subject)} and ${type} in ('all','issue')
          union all
          select 'spec',sp.id::text,'SPEC-'||sp.number,r.content->>'title',
            coalesce((select string_agg(value #>> '{}',E'\n') from jsonb_path_query(r.content::jsonb,'strict $.** ? (@.type() == "string")') value),''),sp.updated_at
          from roster.specs sp join roster.teams t on t.id=sp.team_id
          join roster.spec_revisions r on r.spec_id=sp.id and r.number=sp.current_revision
          where sp.workspace_id=${workspaceId} and ${visible(subject)} and ${type} in ('all','spec')
          union all
          select 'project',p.id::text,p.id::text,p.name,p.description,null::timestamptz
          from roster.projects p where p.workspace_id=${workspaceId} and not p.archived and ${
          visibleProject(subject)
        } and ${type} in ('all','project')
        ), matches as (
          select *,type||':'||case when type='project' then id else identifier end as reference,
            type||':'||id as sort_key,coalesce(updated_at,'epoch'::timestamptz) as sort_date,
            case when lower(identifier)=${q} or lower(title)=${q} then 0
                 when left(lower(title),length(${q}))=${q} then 1
                 when position(${q} in lower(title))>0 then 2 else 3 end as rank
          from candidates where position(${q} in lower(identifier))>0 or position(${q} in lower(title))>0 or position(${q} in lower(body))>0
        )
        select type,id,reference,title,
          substring(body from greatest(1,position(${q} in lower(body))-60) for 240) as excerpt,
          updated_at,rank,sort_key,to_char(sort_date at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_time
        from matches
        ${
          after
            ? sql`where rank>${after.rank} or (rank=${after.rank} and sort_date<${after.time}::timestamptz) or (rank=${after.rank} and sort_date=${after.time}::timestamptz and sort_key>${after.key})`
            : sql``
        }
        order by rank,sort_date desc,sort_key limit ${limit}`,
      );
      return result.map((r) => ({
        type: r.type,
        id: String(r.id),
        reference: String(r.reference),
        title: String(r.title),
        excerpt: String(r.excerpt),
        updated_at: r.updated_at == null ? null : iso(r.updated_at),
        rank: Number(r.rank),
        sort_key: String(r.sort_key),
        sort_time: String(r.sort_time),
      })) as SearchRow[];
    },
  };
}
