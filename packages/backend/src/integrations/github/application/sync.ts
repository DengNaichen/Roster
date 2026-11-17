import type { Session, UnitOfWork } from '../../../application/session.ts';
import { lockWorkspace } from '../../../modules/access/index.ts';
import { applyPullRequestStatus } from '../../../modules/issues/index.ts';
import { type GitHubClient, GitHubError } from './client.ts';
import {
  bindingKey,
  closingReferences,
  type Delivery,
  type GitHubBinding,
  identifiers,
  type Pull,
  pullState,
  type Scan,
} from './model.ts';
import type { Scope, SyncState } from './repository.ts';
export interface GitHubOptions {
  bindings: GitHubBinding[];
  now?: () => number;
}
export function createGitHubSync(db: UnitOfWork, options: GitHubOptions, client: GitHubClient) {
  const now = options.now ?? Date.now;
  const stamp = () => new Date(now()).toISOString();
  async function fenced<T>(scope: Scope, run: (tx: Session) => Promise<T>): Promise<T> {
    return await db.transaction(async (tx) => {
      if (!await tx.github.owned(scope)) throw new GitHubError('lease_lost');
      return await run(tx);
    });
  }
  async function apply(
    tx: Session,
    scope: Scope,
    b: GitHubBinding,
    p: Pull,
    live: boolean,
    connectedAt: string,
    event = false,
  ) {
    await lockWorkspace(tx, scope.workspaceId);
    const old = await tx.github.links(scope, p.number);
    const updatedAt = new Date(p.updated_at).toISOString();
    if (old.some((link) => link.updatedAt > updatedAt)) return;
    const keys = (await tx.github.teamKeys({ workspaceId: scope.workspaceId })).map((t) =>
      String(t.key)
    );
    const closes = closingReferences(`${p.title}\n${p.body ?? ''}`, keys);
    const ids = new Set([...identifiers(`${p.head.ref} ${p.title}`, keys), ...closes]);
    const state = pullState(p);
    // Atomically replace the whole link set, including identifiers removed by title/branch edits.
    await tx.github.removeLinks(scope, p.number);
    for (const id of ids) {
      const issue = await tx.github.findIssue({ workspaceId: scope.workspaceId, identifier: id });
      if (!issue) continue;
      const previous = old.find((link) => link.identifier === id);
      const recentMerge = p.merged_at !== null &&
        Date.parse(p.merged_at) >= Date.parse(connectedAt);
      await tx.github.savePullRequest({
        scope,
        number: p.number,
        issueIdentifier: id,
        title: p.title,
        url: `https://github.com/${b.repo}/pull/${p.number}`,
        headRef: p.head.ref,
        state,
        closes: closes.has(id),
        observedLive: live && (previous?.observedLive === true || event),
        completionEligible: b.completion === 'closing_reference' && recentMerge,
        updatedAt,
      });
    }
    if (!live) return;
    const affected = new Set([...ids, ...old.map((link) => link.identifier)]);
    for (const id of affected) {
      const previous = old.find((link) => link.identifier === id);
      const changed = !ids.has(id) || !previous || previous.state !== state ||
        previous.closes !== closes.has(id) || (event && !previous.observedLive);
      if (!changed) continue;
      const issue = await tx.github.findIssue({ workspaceId: scope.workspaceId, identifier: id });
      if (!issue) continue;
      const pulls = await tx.github.linkedPulls({ workspaceId: scope.workspaceId, identifier: id });
      await applyPullRequestStatus(tx, scope.workspaceId, issue, pulls, `${b.repo}#${p.number}`);
    }
  }
  async function scanPage(
    scope: Scope,
    binding: GitHubBinding,
    state: SyncState,
    deadline: number,
  ) {
    const scan: Scan = state.scan ?? {
      page: 1,
      since: state.lastUpdatedAt
        ? new Date(Date.parse(state.lastUpdatedAt) - 300_000).toISOString()
        : null,
      startedAt: stamp(),
      initial: state.initializedAt === null,
    };
    // Replay the preceding page on resume: GitHub's updated-desc listing is mutable.
    const pages = scan.page > 1 ? [scan.page - 1, scan.page] : [1];
    let done = false;
    for (const page of pages) {
      await fenced(scope, async () => {});
      const pulls = await client.pulls(binding, page);
      for (const p of pulls) {
        if (now() >= deadline) {
          await fenced(scope, (tx) => tx.github.checkpoint(scope, scan));
          return { done: false, page: scan.page };
        }
        const updatedAt = new Date(p.updated_at).toISOString();
        if (scan.since && updatedAt < scan.since) {
          done = true;
          break;
        }
        await fenced(scope, (tx) => apply(tx, scope, binding, p, !scan.initial, state.connectedAt));
      }
      if (pulls.length < 100) done = true;
      if (done) break;
    }
    await fenced(scope, async (tx) => {
      if (done) {
        // Watermark is scan start, never scan end: changes during pagination get revisited.
        await tx.github.completeScan(
          scope,
          scan.startedAt,
          stamp(),
          new Date(now() + 6 * 3600_000).toISOString(),
        );
      } else {
        await tx.github.checkpoint(scope, { ...scan, page: scan.page + 1 });
      }
    });
    return { done, page: scan.page };
  }
  return {
    async accept(delivery: Delivery) {
      const binding = options.bindings.find((b) =>
        b.installationId === delivery.installationId && b.repositoryId === delivery.repositoryId
      );
      if (!binding) return false;
      const w = await db.github.workspace({ workspace: binding.workspace });
      await db.github.record({
        workspaceId: String(w.id),
        repo: binding.repo,
        key: bindingKey(binding),
        delivery,
      });
      return true;
    },
    async run() {
      const results: {
        repo: string;
        processed?: number;
        retried?: number;
        dead?: number;
        scan?: unknown;
        skipped?: boolean;
        error?: string;
      }[] = [];
      const deadline = now() + 40_000;
      for (const binding of options.bindings) {
        if (now() >= deadline) {
          results.push({ repo: binding.repo, skipped: true });
          continue;
        }
        let scope: Scope | undefined;
        try {
          const w = await db.github.workspace({ workspace: binding.workspace });
          scope = {
            workspaceId: String(w.id),
            repo: binding.repo,
            key: bindingKey(binding),
            lease: crypto.randomUUID(),
          };
          await db.github.configure({ workspaceId: scope.workspaceId, binding, key: scope.key });
          const state = await db.github.claim(scope);
          if (!state) {
            results.push({ repo: binding.repo, skipped: true });
            continue;
          }
          const ownedScope = scope;
          if (state.blockedUntil && Date.parse(state.blockedUntil) > now()) {
            results.push({ repo: binding.repo, error: 'binding_backoff' });
            continue;
          }
          const pending = await fenced(ownedScope, (tx) => tx.github.pending(ownedScope, stamp()));
          const due = Date.parse(state.reconcileAfter) <= now();
          if (!pending.length && !due) {
            results.push({ repo: binding.repo, processed: 0 });
            continue;
          }
          // This check and repository-restricted token exchange verify installation access before any writes.
          let verified = false;
          let blocked = false;
          const report = {
            repo: binding.repo,
            processed: 0,
            retried: 0,
            dead: 0,
            scan: undefined as unknown,
          };
          for (const delivery of state.initializedAt ? pending : []) {
            if (now() >= deadline) break;
            if (delivery.attempts >= 8) {
              await fenced(
                ownedScope,
                (tx) => tx.github.finish(ownedScope, delivery, 'dead', 'attempts_exhausted'),
              );
              report.dead++;
              continue;
            }
            await fenced(ownedScope, (tx) => tx.github.attempt(ownedScope, delivery));
            try {
              if (!verified) {
                await client.verify(binding);
                verified = true;
              }
              const p = await client.pull(binding, delivery.number);
              await fenced(ownedScope, async (tx) => {
                await apply(
                  tx,
                  ownedScope,
                  binding,
                  p,
                  state.initializedAt !== null,
                  state.connectedAt,
                  true,
                );
                await tx.github.finish(ownedScope, delivery, 'applied');
              });
              report.processed++;
            } catch (error) {
              const code = error instanceof GitHubError ? error.code : 'processing_failed';
              if (code === 'lease_lost') throw error;
              const attempts = delivery.attempts + 1;
              const delay = Math.min(30_000 * 2 ** (attempts - 1), 3600_000);
              const retryAt = Math.max(
                now() + delay,
                error instanceof GitHubError ? error.retryAt ?? 0 : 0,
              );
              await fenced(ownedScope, async (tx) => {
                if (attempts >= 8) await tx.github.finish(ownedScope, delivery, 'dead', code);
                else {await tx.github.retry(
                    ownedScope,
                    delivery,
                    new Date(retryAt).toISOString(),
                    code,
                  );}
              });
              if (attempts >= 8) report.dead++;
              else report.retried++;
              // Respect upstream rate limits and access loss for the rest of this binding run.
              if (
                code === 'rate_limited' ||
                ['http_401', 'http_403', 'http_404', 'repository_mismatch'].includes(code)
              ) {
                await fenced(
                  ownedScope,
                  (tx) => tx.github.pause(ownedScope, new Date(retryAt).toISOString(), code),
                );
                blocked = true;
                break;
              }
            }
          }
          if (due && !blocked && now() < deadline) {
            try {
              if (!verified) await client.verify(binding);
              report.scan = await scanPage(ownedScope, binding, state, deadline);
            } catch (error) {
              const code = error instanceof GitHubError ? error.code : 'scan_failed';
              const at = new Date(
                Math.max(now() + 900_000, error instanceof GitHubError ? error.retryAt ?? 0 : 0),
              ).toISOString();
              await fenced(ownedScope, async (tx) => {
                await tx.github.failScan(ownedScope, at, code);
                if (
                  code === 'rate_limited' ||
                  ['http_401', 'http_403', 'http_404', 'repository_mismatch'].includes(code)
                ) {
                  await tx.github.pause(ownedScope, at, code);
                }
              });
              throw error;
            }
          }
          results.push(report);
        } catch (error) {
          results.push({
            repo: binding.repo,
            error: error instanceof GitHubError ? error.code : 'synchronization_failed',
          });
        } finally {
          if (scope) await db.github.release(scope);
        }
      }
      return results;
    },
  };
}
