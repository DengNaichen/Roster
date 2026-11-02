import { sql } from 'npm:drizzle-orm@0.45.4';
import { applyPullRequestStatus } from '../modules/issues/index.ts';
import type { Database } from '../platform/database/client.ts';
import { one, rows } from '../platform/database/query.ts';

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
  token: string;
  linkback?: boolean;
  fetch?: typeof fetch;
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
export function createGitHubSync(db: Database, options: GitHubOptions) {
  if (options.bindings.length && !options.token) throw new Error('GITHUB_TOKEN is required');
  // Only GitHub API paths composed from configured owner/repo and numeric IDs are used.
  async function request(path: string, body?: unknown): Promise<unknown> {
    const response = await (options.fetch ?? fetch)(`https://api.github.com${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
    return await response.json();
  }
  async function notify(repo: string) {
    const bindings = options.bindings.filter((b) => b.repo === repo);
    for (const b of bindings) {
      await db.execute(
        sql`insert into roster.github_sync(workspace_id,repo,requested_at) select id,${b.repo},now() from roster.workspaces where slug=${b.workspace} on conflict(workspace_id,repo) do update set requested_at=now()`,
      );
    }
    return bindings.length > 0;
  }
  async function sync(binding: GitHubBinding) {
    if (
      !options.bindings.some((b) => b.workspace === binding.workspace && b.repo === binding.repo)
    ) throw new Error('Repository is not configured');
    const w = await one(db, sql`select id from roster.workspaces where slug=${binding.workspace}`);
    await db.execute(
      sql`insert into roster.github_sync(workspace_id,repo) values(${w.id},${binding.repo}) on conflict do nothing`,
    );
    const lease = crypto.randomUUID();
    const claimed = (await rows(
      db,
      sql`update roster.github_sync set lease_token=${lease},lease_until=now()+interval '90 seconds' where workspace_id=${w.id} and repo=${binding.repo} and (lease_until is null or lease_until<now()) returning last_updated_at`,
    ))[0];
    if (!claimed) return { skipped: true, pulls: 0 };
    let newest = claimed.last_updated_at
      ? new Date(String(claimed.last_updated_at)).toISOString()
      : null;
    const since = newest;
    let count = 0;
    const keys = (await rows(db, sql`select key from roster.teams where workspace_id=${w.id}`)).map(
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
              const owned = (await rows(
                tx,
                sql`select 1 from roster.github_sync where workspace_id=${w.id} and repo=${binding.repo} and lease_token=${lease} and lease_until>now() for update`,
              ))[0];
              if (!owned) throw new Error('GitHub sync lease expired');
              await tx.execute(
                sql`update roster.github_sync set lease_until=now()+interval '90 seconds' where workspace_id=${w.id} and repo=${binding.repo}`,
              );
              await one(tx, sql`select id from roster.workspaces where id=${w.id} for update`);
              const ps = state(p);
              const link = await one(
                tx,
                sql`insert into roster.pull_requests(workspace_id,repo,number,issue_identifier,title,url,head_ref,state,updated_at) values(${w.id},${binding.repo},${p.number},${id},${p.title},${`https://github.com/${binding.repo}/pull/${p.number}`},${p.head.ref},${ps},${stamp}) on conflict(workspace_id,repo,number,issue_identifier) do update set title=excluded.title,url=excluded.url,head_ref=excluded.head_ref,state=excluded.state,updated_at=excluded.updated_at returning linkback_posted_at`,
              );
              const issue = (await rows(
                tx,
                sql`select i.*,t.private from roster.issues i join roster.teams t on t.id=i.team_id where i.workspace_id=${w.id} and i.identifier=${id}`,
              ))[0];
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
                      : `**${id} · ${issue.title}**\n\n<details>\n\n${issue.description}\n\n</details>`) +
                      `\n\n${marker}`,
                  });
                }
                await tx.execute(
                  sql`update roster.pull_requests set linkback_posted_at=now() where workspace_id=${w.id} and repo=${binding.repo} and number=${p.number} and issue_identifier=${id}`,
                );
              }
            });
          }
          count++;
        }
        if (data.length < 100) break;
        const alive = await rows(
          db,
          sql`update roster.github_sync set lease_until=now()+interval '90 seconds' where workspace_id=${w.id} and repo=${binding.repo} and lease_token=${lease} and lease_until>now() returning repo`,
        );
        if (!alive.length) throw new Error('GitHub sync lease expired');
      }
      await db.execute(
        sql`update roster.github_sync set last_updated_at=${newest},requested_at=null where workspace_id=${w.id} and repo=${binding.repo} and lease_token=${lease}`,
      );
      return { skipped: false, pulls: count };
    } finally {
      await db.execute(
        sql`update roster.github_sync set lease_token=null,lease_until=null where workspace_id=${w.id} and repo=${binding.repo} and lease_token=${lease}`,
      );
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
export function githubWebhook(
  sync: Pick<ReturnType<typeof createGitHubSync>, 'notify'>,
  secret: string,
) {
  return async (request: Request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 1_048_576) {
          await reader.cancel();
          return new Response('Payload too large', { status: 413 });
        }
        chunks.push(part.value);
      }
    }
    const bytes = new Uint8Array(length);
    let pos = 0;
    for (const part of chunks) {
      bytes.set(part, pos);
      pos += part.length;
    }
    const signature = request.headers.get('x-hub-signature-256') ?? '';
    if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
      return new Response('Invalid signature', { status: 401 });
    }
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sig = Uint8Array.from(signature.slice(7).match(/../g)!, (h) => parseInt(h, 16));
    if (!await crypto.subtle.verify('HMAC', key, sig, bytes)) {
      return new Response('Invalid signature', { status: 401 });
    }
    if (request.headers.get('x-github-event') !== 'pull_request') {
      return new Response(null, { status: 204 });
    }
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return new Response('Invalid payload', { status: 400 });
    }
    if (typeof payload?.repository?.full_name !== 'string') {
      return new Response('Invalid repository', { status: 400 });
    }
    return new Response(null, {
      status: await sync.notify(payload.repository.full_name) ? 202 : 204,
    });
  };
}
