import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one, rows } from '../../../platform/database/query.ts';
import type { GitHubRepository } from '../application/repository.ts';

export function createGitHubRepository(db: Executor): GitHubRepository {
  return {
    async requestSync({ repo, workspace }) {
      await db.execute(
        sql`insert into roster.github_sync(workspace_id,repo,requested_at) select id,${repo},now() from roster.workspaces where slug=${workspace} on conflict(workspace_id,repo) do update set requested_at=now()`,
      );
    },
    async workspace({ workspace }) {
      return one(db, sql`select id from roster.workspaces where slug=${workspace}`);
    },
    async ensureCursor({ workspaceId, repo }) {
      await db.execute(
        sql`insert into roster.github_sync(workspace_id,repo) values(${workspaceId},${repo}) on conflict do nothing`,
      );
    },
    async claimLease({ lease, workspaceId, repo }) {
      return rows(
        db,
        sql`update roster.github_sync set lease_token=${lease},lease_until=now()+interval '90 seconds' where workspace_id=${workspaceId} and repo=${repo} and (lease_until is null or lease_until<now()) returning last_updated_at`,
      );
    },
    async teamKeys({ workspaceId }) {
      return rows(db, sql`select key from roster.teams where workspace_id=${workspaceId}`);
    },
    async ownedLease({ workspaceId, repo, lease }) {
      return rows(
        db,
        sql`select 1 from roster.github_sync where workspace_id=${workspaceId} and repo=${repo} and lease_token=${lease} and lease_until>now() for update`,
      );
    },
    async renewLockedLease({ workspaceId, repo }) {
      await db.execute(
        sql`update roster.github_sync set lease_until=now()+interval '90 seconds' where workspace_id=${workspaceId} and repo=${repo}`,
      );
    },

    async savePullRequest(
      { workspaceId, repo, number, issueIdentifier, title, url, headRef, state, updatedAt },
    ) {
      return one(
        db,
        sql`insert into roster.pull_requests(workspace_id,repo,number,issue_identifier,title,url,head_ref,state,updated_at) values(${workspaceId},${repo},${number},${issueIdentifier},${title},${url},${headRef},${state},${updatedAt}) on conflict(workspace_id,repo,number,issue_identifier) do update set title=excluded.title,url=excluded.url,head_ref=excluded.head_ref,state=excluded.state,updated_at=excluded.updated_at returning linkback_posted_at`,
      );
    },
    async findIssue({ workspaceId, identifier }) {
      return rows(
        db,
        sql`select i.*,t.private from roster.issues i join roster.teams t on t.id=i.team_id where i.workspace_id=${workspaceId} and i.identifier=${identifier}`,
      );
    },
    async markLinkback({ workspaceId, repo, number, issueIdentifier }) {
      await db.execute(
        sql`update roster.pull_requests set linkback_posted_at=now() where workspace_id=${workspaceId} and repo=${repo} and number=${number} and issue_identifier=${issueIdentifier}`,
      );
    },
    async renewLease({ workspaceId, repo, lease }) {
      return rows(
        db,
        sql`update roster.github_sync set lease_until=now()+interval '90 seconds' where workspace_id=${workspaceId} and repo=${repo} and lease_token=${lease} and lease_until>now() returning repo`,
      );
    },
    async advanceCursor({ newest, workspaceId, repo, lease }) {
      await db.execute(
        sql`update roster.github_sync set last_updated_at=${newest},requested_at=null where workspace_id=${workspaceId} and repo=${repo} and lease_token=${lease}`,
      );
    },
    async releaseLease({ workspaceId, repo, lease }) {
      await db.execute(
        sql`update roster.github_sync set lease_token=null,lease_until=null where workspace_id=${workspaceId} and repo=${repo} and lease_token=${lease}`,
      );
    },
  };
}
