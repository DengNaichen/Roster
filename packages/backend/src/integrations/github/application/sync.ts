import type { UnitOfWork } from '../../../application/session.ts';
import { lockWorkspace } from '../../../modules/access/index.ts';
import { applyPullRequestStatus } from '../../../modules/issues/index.ts';
import type { GitHubClient } from './client.ts';

export type GitHubBinding = { workspace: string; repo: string };
export type Pull = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged_at: string | null;
  updated_at: string;
  head: { ref: string };
};
export interface GitHubOptions {
  bindings: GitHubBinding[];
  linkback?: boolean;
}
export function parseBindings(value = ''): GitHubBinding[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('GITHUB_BINDINGS must be an array');
  return parsed.map((b) => {
    if (
      !b || typeof b.workspace !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(b.workspace) ||
      typeof b.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(b.repo)
    ) throw new Error('Invalid GitHub workspace/repository binding');
    return { workspace: b.workspace, repo: b.repo };
  });
}
export function identifiers(text: string, keys: string[]): string[] {
  if (!keys.length) return [];
  const normalized = new Map(keys.map((k) => [k.toUpperCase(), k]));
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return [
    ...new Set(
      [...text.matchAll(new RegExp(`\\b(${escaped.join('|')})-(\\d+)`, 'gi'))].map((m) =>
        `${normalized.get(m[1].toUpperCase())}-${m[2]}`
      ),
    ),
  ];
}
function state(pull: Pull) {
  return pull.merged_at
    ? 'merged'
    : pull.state === 'closed'
    ? 'closed'
    : pull.draft
    ? 'draft'
    : 'open';
}
export function createGitHubSync(db: UnitOfWork, options: GitHubOptions, client: GitHubClient) {
  const request = client.request;
  async function notify(repo: string) {
    const bindings = options.bindings.filter((b) => b.repo === repo);
    for (const b of bindings) {
      await db.github.requestSync({ repo: b.repo, workspace: b.workspace });
    }
    return bindings.length > 0;
  }
  async function sync(binding: GitHubBinding) {
    if (
      !options.bindings.some((b) => b.workspace === binding.workspace && b.repo === binding.repo)
    ) throw new Error('Repository is not configured');
    const w = await db.github.workspace({ workspace: binding.workspace });
    await db.github.ensureCursor({ workspaceId: w.id, repo: binding.repo });
    const lease = crypto.randomUUID();
    const claimed =
      (await db.github.claimLease({ lease, workspaceId: w.id, repo: binding.repo }))[0];
    if (!claimed) return { skipped: true, pulls: 0 };
    let newest = claimed.last_updated_at
      ? new Date(String(claimed.last_updated_at)).toISOString()
      : null;
    const since = newest;
    let count = 0;
    const keys = (await db.github.teamKeys({ workspaceId: w.id })).map(
      (t) => String(t.key),
    );
    try {
      pages: for (let page = 1;; page++) {
        const data = await request(
          `/repos/${binding.repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
        );
        if (!Array.isArray(data)) throw new Error('Invalid GitHub response');
        for (const p of data as Pull[]) {
          if (
            !Number.isSafeInteger(p.number) || p.number < 1 || !p.head ||
            typeof p.head.ref !== 'string' || typeof p.title !== 'string' ||
            !Number.isFinite(Date.parse(p.updated_at))
          ) throw new Error('Invalid GitHub pull request');
          const stamp = new Date(p.updated_at).toISOString();
          if (since && stamp < since) break pages;
          if (!newest || stamp > newest) newest = stamp;
          for (const id of identifiers(`${p.head.ref} ${p.title}`, keys)) {
            await db.transaction(async (tx) => {
              // Lease and workspace locks fence concurrent workers and privacy changes.
              const owned =
                (await tx.github.ownedLease({ workspaceId: w.id, repo: binding.repo, lease }))[0];
              if (!owned) throw new Error('GitHub sync lease expired');
              await tx.github.renewLockedLease({ workspaceId: w.id, repo: binding.repo });
              await lockWorkspace(tx, w.id);
              const ps = state(p);
              const link = await tx.github.savePullRequest({
                workspaceId: w.id,
                repo: binding.repo,
                number: p.number,
                issueIdentifier: id,
                title: p.title,
                url: `https://github.com/${binding.repo}/pull/${p.number}`,
                headRef: p.head.ref,
                state: ps,
                updatedAt: stamp,
              });
              const issue = (await tx.github.findIssue({ workspaceId: w.id, identifier: id }))[0];
              if (!issue) return;
              await applyPullRequestStatus(
                tx,
                String(w.id),
                issue,
                ps,
                `${binding.repo}#${p.number}`,
              );
              if (options.linkback && !link.linkback_posted_at && p.state === 'open') {
                const marker = `<!-- roster:${w.id}:${id} -->`;
                // Reconcile a successful post whose local commit was interrupted.
                let posted = false;
                for (let commentPage = 1;; commentPage++) {
                  const comments = await request(
                    `/repos/${binding.repo}/issues/${p.number}/comments?per_page=100&page=${commentPage}`,
                  ) as { body?: string }[];
                  if (!Array.isArray(comments)) throw new Error('Invalid GitHub comments response');
                  if (comments.some((c) => c.body?.includes(marker))) {
                    posted = true;
                    break;
                  }
                  if (comments.length < 100) break;
                }
                if (!posted) {
                  await request(`/repos/${binding.repo}/issues/${p.number}/comments`, {
                    body: (issue.private
                      ? `**${id}**`
                      : `**${id} · ${issue.title}**\n\n<details>\n\n${issue.document_text}\n\n</details>`) +
                      `\n\n${marker}`,
                  });
                }
                await tx.github.markLinkback({
                  workspaceId: w.id,
                  repo: binding.repo,
                  number: p.number,
                  issueIdentifier: id,
                });
              }
            });
          }
          count++;
        }
        if (data.length < 100) break;
        const alive = await db.github.renewLease({ workspaceId: w.id, repo: binding.repo, lease });
        if (!alive.length) throw new Error('GitHub sync lease expired');
      }
      await db.github.advanceCursor({ newest, workspaceId: w.id, repo: binding.repo, lease });
      return { skipped: false, pulls: count };
    } finally {
      await db.github.releaseLease({ workspaceId: w.id, repo: binding.repo, lease });
    }
  }
  return {
    notify,
    sync,
    async run() {
      const results = [];
      for (const binding of options.bindings) {
        try {
          results.push({ ...binding, ...await sync(binding) });
        } catch {
          results.push({ ...binding, error: 'GitHub synchronization failed; retry on next run' });
        }
      }
      return results;
    },
  };
}
