import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one, rows } from '../../../platform/database/query.ts';
import type { GitHubRepository, PendingDelivery, Scope } from '../application/repository.ts';
import { scanSchema } from '../application/model.ts';
import { z } from 'zod';
const linkSchema = z.object({
  issue_identifier: z.string(),
  state: z.enum(['open', 'draft', 'merged', 'closed']),
  closes: z.boolean(),
  observed_live: z.boolean(),
  updated_at: z.coerce.date(),
});
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
export function createGitHubRepository(db: Executor): GitHubRepository {
  const fence = (s: Scope) =>
    sql`workspace_id=${s.workspaceId} and repo=${s.repo} and binding_key=${s.key} and lease_token=${s.lease} and lease_until>now()`;
  const group = (s: Scope, w: PendingDelivery) =>
    sql`workspace_id=${s.workspaceId} and repo=${s.repo} and binding_key=${s.key} and pull_number=${w.number} and received_at<=${w.cutoff}::timestamptz and completed_at is null`;
  return {
    async workspace({ workspace }) {
      return one(db, sql`select id from roster.workspaces where slug=${workspace}`);
    },
    async configure({ workspaceId, binding, key }) {
      await db.execute(
        sql`insert into roster.github_sync(workspace_id,repo,binding_key) values(${workspaceId},${binding.repo},${key})
        on conflict(workspace_id,repo) do update set binding_key=excluded.binding_key,
        last_updated_at=null,initialized_at=null,connected_at=now(),reconcile_after=now(),scan=null,
        failures=0,last_error=null,blocked_until=null,lease_token=null,lease_until=null
        where github_sync.binding_key is null`,
      );
      const current = await one(
        db,
        sql`select binding_key from roster.github_sync where workspace_id=${workspaceId} and repo=${binding.repo}`,
      );
      if (current.binding_key !== key) {
        throw new Error('Binding differs from stored identity; operator reset required');
      }
    },
    async claim(s) {
      const r = (await rows(
        db,
        sql`update roster.github_sync set lease_token=${s.lease},lease_until=now()+interval '90 seconds'
        where workspace_id=${s.workspaceId} and repo=${s.repo} and binding_key=${s.key}
        and (lease_until is null or lease_until<now()) returning *`,
      ))[0];
      if (!r) return null;
      return {
        initializedAt: r.initialized_at ? iso(r.initialized_at) : null,
        connectedAt: iso(r.connected_at),
        lastUpdatedAt: r.last_updated_at ? iso(r.last_updated_at) : null,
        reconcileAfter: iso(r.reconcile_after),
        blockedUntil: r.blocked_until ? iso(r.blocked_until) : null,
        scan: r.scan ? scanSchema.parse(r.scan) : null,
      };
    },
    async owned(s) {
      const r = await rows(db, sql`select 1 from roster.github_sync where ${fence(s)} for update`);
      if (!r.length) return false;
      await db.execute(
        sql`update roster.github_sync set lease_until=now()+interval '90 seconds' where ${
          fence(s)
        }`,
      );
      return true;
    },
    async release(s) {
      await db.execute(sql`update roster.github_sync set lease_token=null,lease_until=null
        where workspace_id=${s.workspaceId} and repo=${s.repo} and binding_key=${s.key} and lease_token=${s.lease}`);
    },
    async teamKeys({ workspaceId }) {
      return rows(db, sql`select key from roster.teams where workspace_id=${workspaceId}`);
    },
    async record({ workspaceId, repo, key, delivery }) {
      await db.execute(
        sql`insert into roster.github_deliveries(workspace_id,delivery_id,body_hash,repo,binding_key,pull_number,action)
        values(${workspaceId},${delivery.deliveryId},${delivery.bodyHash},${repo},${key},${delivery.number},${delivery.action})
        on conflict do nothing`,
      );
    },
    async pending(s, now) {
      // A changed trusted mapping cannot route previously accepted work into its new authority.
      await db.execute(
        sql`update roster.github_deliveries set completed_at=now(),outcome='ignored',last_error='binding_changed'
        where workspace_id=${s.workspaceId} and repo=${s.repo} and binding_key<>${s.key} and completed_at is null`,
      );
      return (await rows(
        db,
        sql`select pull_number,max(attempts) attempts,now() as cutoff from roster.github_deliveries
        where workspace_id=${s.workspaceId} and repo=${s.repo} and binding_key=${s.key}
        and completed_at is null and available_at<=${now} group by pull_number order by min(received_at),pull_number limit 20`,
      ))
        .map((r) => ({
          cutoff: iso(r.cutoff),
          number: Number(r.pull_number),
          attempts: Number(r.attempts),
        }));
    },
    async attempt(s, work) {
      await db.execute(
        sql`update roster.github_deliveries set attempts=least(attempts+1,8) where ${
          group(s, work)
        }`,
      );
    },
    async finish(s, work, outcome, error) {
      await db.execute(
        sql`update roster.github_deliveries set completed_at=now(),outcome=${outcome},last_error=${
          error ?? null
        } where ${group(s, work)}`,
      );
      if (outcome === 'dead') {
        await db.execute(
          sql`update roster.github_sync set reconcile_after=now() where ${fence(s)}`,
        );
      }
    },
    async retry(s, work, at, error) {
      await db.execute(
        sql`update roster.github_deliveries set available_at=${at},last_error=${error} where ${
          group(s, work)
        }`,
      );
    },
    async links(s, number) {
      return (await rows(
        db,
        sql`select issue_identifier,state,closes,observed_live,updated_at from roster.pull_requests
        where workspace_id=${s.workspaceId} and repo=${s.repo} and number=${number}`,
      )).map((value) => {
        const r = linkSchema.parse(value);
        return {
          identifier: r.issue_identifier,
          state: r.state,
          closes: r.closes,
          observedLive: r.observed_live,
          updatedAt: r.updated_at.toISOString(),
        };
      });
    },
    async removeLinks(s, number) {
      await db.execute(
        sql`delete from roster.pull_requests where workspace_id=${s.workspaceId} and repo=${s.repo} and number=${number}`,
      );
    },
    async savePullRequest(
      {
        scope: s,
        number,
        issueIdentifier,
        title,
        url,
        headRef,
        state,
        closes,
        observedLive,
        completionEligible,
        updatedAt,
      },
    ) {
      await db.execute(
        sql`insert into roster.pull_requests(workspace_id,repo,number,issue_identifier,title,url,head_ref,state,closes,observed_live,completion_eligible,updated_at)
        values(${s.workspaceId},${s.repo},${number},${issueIdentifier},${title},${url},${headRef},${state},${closes},${observedLive},${completionEligible},${updatedAt})
        on conflict(workspace_id,repo,number,issue_identifier) do update set title=excluded.title,url=excluded.url,head_ref=excluded.head_ref,
        state=excluded.state,closes=excluded.closes,observed_live=excluded.observed_live,completion_eligible=excluded.completion_eligible,updated_at=excluded.updated_at where pull_requests.updated_at<=excluded.updated_at`,
      );
    },
    async findIssue({ workspaceId, identifier }) {
      return (await rows(
        db,
        sql`select * from roster.issues where workspace_id=${workspaceId} and identifier=${identifier}`,
      ))[0] ?? null;
    },
    async linkedPulls({ workspaceId, identifier }) {
      return (await rows(
        db,
        sql`select state,closes,completion_eligible from roster.pull_requests where workspace_id=${workspaceId} and issue_identifier=${identifier}`,
      ))
        .map((r) => ({
          state: String(r.state),
          closes: r.closes === true,
          completionEligible: r.completion_eligible === true,
        }));
    },
    async checkpoint(s, scan) {
      await db.execute(
        sql`update roster.github_sync set scan=${JSON.stringify(scan)}::jsonb where ${fence(s)}`,
      );
    },
    async completeScan(s, watermark, at, next) {
      await db.execute(
        sql`update roster.github_sync set last_updated_at=${watermark},initialized_at=coalesce(initialized_at,${at}::timestamptz),
        scan=null,reconcile_after=${next},failures=0,last_error=null where ${fence(s)}`,
      );
    },
    async pause(s, at, error) {
      await db.execute(
        sql`update roster.github_sync set blocked_until=${at},last_error=${error} where ${
          fence(s)
        }`,
      );
    },
    async failScan(s, at, error) {
      await db.execute(
        sql`update roster.github_sync set reconcile_after=${at},failures=failures+1,last_error=${error} where ${
          fence(s)
        }`,
      );
    },
  };
}
