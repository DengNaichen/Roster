import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one } from '../../../platform/database/query.ts';
import type { IssuesRepository } from '../application/repository.ts';
import { hydrateIssueCatalog } from './catalog-query.ts';
import { readIssue } from './read-model.ts';

export function createIssuesRepository(db: Executor): IssuesRepository {
  return {
    async setPullRequestStatus(workspaceId, issueId, status) {
      await db.execute(
        sql`update roster.issues set status=${status},updated_at=now() where workspace_id=${workspaceId} and id=${issueId}`,
      );
    },

    readIssue: (ctx, w, id) => readIssue(db, ctx, w, id),
    hydrateCatalog: (ctx, workspaceId, issues) => hydrateIssueCatalog(db, ctx, workspaceId, issues),
    async touchLabeledIssue({ issueId }) {
      await db.execute(
        sql`update roster.issues set updated_at=clock_timestamp() where id=${issueId}`,
      );
    },

    async rollCycle({ nextCycleId, now, cycleId }) {
      await db.execute(
        sql`update roster.issues set cycle_id=${nextCycleId},updated_at=${now} where cycle_id=${cycleId} and status in ('todo','agent_ready','in_progress','in_review')`,
      );
    },
    async clearPendingCycles({ clock, teamId }) {
      await db.execute(
        sql`update roster.issues set cycle_id=null,updated_at=${clock} where cycle_id in(select id from roster.cycles where team_id=${teamId} and completed_at is null)`,
      );
    },
    async markDelegated({ issueId }) {
      return one(
        db,
        sql`update roster.issues set status='in_progress',updated_at=clock_timestamp() where id=${issueId} returning *`,
      );
    },
  };
}
