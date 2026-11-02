import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one, rows } from '../../../platform/database/query.ts';
import { visible } from '../../access/postgres.ts';
import type { SpecsRepository } from '../application/repository.ts';
const revisionColumns =
  sql`r.number,r.message,r.created_at,r.content,u.subject as author_subject,u.name as author_name,u.email as author_email`;
const revisionFrom =
  sql`from roster.spec_revisions r left join roster.users u on u.subject=r.author_subject`;

export function createSpecsRepository(db: Executor): SpecsRepository {
  return {
    async findSpec({ workspaceId, number, subject }) {
      return one(
        db,
        sql`select sp.*,t.key as team from roster.specs sp join roster.teams t on t.id=sp.team_id where sp.workspace_id=${workspaceId} and sp.number=${number} and ${
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
        sql`select sp.number,t.key as team,r.content->>'title' as title,r.content->>'status' as status,sp.current_revision,sp.updated_at from roster.specs sp join roster.teams t on t.id=sp.team_id join roster.spec_revisions r on r.spec_id=sp.id and r.number=sp.current_revision where sp.workspace_id=${workspaceId} and ${
          visible(subject)
        } ${
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
