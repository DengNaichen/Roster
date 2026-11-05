import { Pool } from 'npm:pg@8.23.1';
import { createDatabase } from '../platform/database/client.ts';
import { createService } from '../service.ts';
import { cleanupWorkspace, prepareTestDatabase } from '../test_support.ts';
import { githubWebhook, identifiers, parseBindings, type Pull } from './github/index.ts';
import { createGitHubIntegration } from './github/postgres.ts';
const assert = (v: unknown, m = 'Assertion failed') => {
  if (!v) throw new Error(m);
};
Deno.test('GitHub identifiers and webhook authenticate before scheduling', async () => {
  assert(JSON.stringify(identifiers('al-1 AL-1 feature/AL-2 XX-7', ['AL'])) === '["AL-1","AL-2"]');
  let rejected = false;
  try {
    parseBindings('[{"workspace":"demo","repo":"../private/token"}]');
  } catch {
    rejected = true;
  }
  assert(rejected);
  let notifications = 0;
  const handler = githubWebhook({
    notify: async (repo) => {
      notifications++;
      return repo === 'owner/repo';
    },
  }, 'test-secret');
  const body = JSON.stringify({
    repository: { full_name: 'owner/repo' },
    pull_request: { title: 'untrusted' },
  });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('test-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = 'sha256=' +
    Array.from(
      new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))),
      (v) => v.toString(16).padStart(2, '0'),
    ).join('');
  const send = (sig: string) =>
    handler(
      new Request('https://app/webhook', {
        method: 'POST',
        headers: { 'x-hub-signature-256': sig, 'x-github-event': 'pull_request' },
        body,
      }),
    );
  assert((await send('bad')).status === 401 && notifications === 0);
  assert((await send(signature)).status === 202 && notifications === 1);
});
const url = Deno.env.get('ROSTER_INTEGRATIONS_TEST_DATABASE_URL');
Deno.test({
  name:
    'GitHub sync persists cursors, advances status, fences workers and redacts private linkbacks',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const setup = new Pool({ connectionString: url, max: 2 });
    await prepareTestDatabase(setup);
    const runtimeUrl = new URL(url!);
    runtimeUrl.username = 'roster_test_runtime';
    const runtime = createDatabase(runtimeUrl.toString());
    const ctx = {
      identity: { subject: crypto.randomUUID(), name: 'Sync tester', email: 'sync@test.local' },
    };
    const s = createService(runtime.db);
    const w = await s.createWorkspace(ctx, {
      slug: 'gh-' + crypto.randomUUID(),
      name: 'GitHub tests',
    });
    const binding = { workspace: w.slug, repo: 'owner/repo' };
    const posts: string[] = [];
    let fail = false;
    let pulls: Pull[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const requestUrl = String(input);
      if (fail) return new Response('failure', { status: 503 });
      if (requestUrl.includes('/pulls?')) return Response.json(pulls);
      const config = init as { method?: string; body?: unknown } | undefined;
      if (config?.method === 'POST') {
        posts.push(String(config.body));
        return Response.json({ id: 1 });
      }
      return Response.json([]);
    };
    try {
      await s.createTeam(ctx, w.slug, { key: 'AA', name: 'Public' });
      await s.createTeam(ctx, w.slug, { key: 'PR', name: 'Private', private: true });
      const issue = await s.createIssue(ctx, w.slug, {
        team: 'AA',
        title: 'Public title',
        document: {
          lead: 'Public lead',
          sections: [{
            title: 'Scope',
            blocks: [{ type: 'paragraph', text: 'Public description' }],
          }],
          criteria: [{ id: 'AC-1', title: 'Linked back', detail: '', done: true }],
        },
      });
      const hidden = await s.createIssue(ctx, w.slug, {
        team: 'PR',
        title: 'PRIVATE TITLE',
        document: { lead: 'PRIVATE BODY', sections: [], criteria: [] },
      });
      pulls = [{
        number: 1,
        title: `${issue.identifier} ${hidden.identifier}`,
        state: 'open',
        draft: false,
        merged_at: null,
        updated_at: '2026-01-01T00:00:00Z',
        head: { ref: 'feature/' + issue.identifier },
      }];
      const sync = createGitHubIntegration(runtime.db, {
        bindings: [binding],
        token: 'fake-test-token',
        linkback: true,
        fetch: fetchMock,
      });
      const [a, b] = await Promise.all([sync.sync(binding), sync.sync(binding)]);
      assert(a.skipped !== b.skipped, 'Only one lease holder');
      assert((await s.getIssue(ctx, w.slug, issue.identifier)).status === 'in_review');
      assert(posts.length === 2, 'One linkback for each matched issue');
      assert(
        posts.some((p) =>
          p.includes('Public lead\\nScope\\nPublic description\\n[x] Linked back')
        ) &&
          !posts.some((p) => p.includes('PRIVATE')) && !posts.some((p) => p.includes('"lead"')),
        'Private title/body never leave the app',
      );
      await sync.sync(binding);
      assert(posts.length === 2, 'Repeated sync does not repeat linkback');
      const linked = await s.getIssue(ctx, w.slug, issue.identifier);
      assert(linked.pull_requests.length === 1, 'Details expose persisted PR');
      pulls = [{
        ...pulls[0],
        state: 'closed',
        merged_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      }];
      await sync.sync(binding);
      assert((await s.getIssue(ctx, w.slug, issue.identifier)).status === 'done');
      pulls = [{ ...pulls[0], state: 'open', merged_at: null, updated_at: '2026-01-03T00:00:00Z' }];
      await sync.sync(binding);
      assert(
        (await s.getIssue(ctx, w.slug, issue.identifier)).status === 'done',
        'Reopen cannot move done backwards',
      );
      const before =
        (await setup.query('select last_updated_at from roster.github_sync where workspace_id=$1', [
          w.id,
        ])).rows[0].last_updated_at;
      fail = true;
      let failed = false;
      try {
        await sync.sync(binding);
      } catch {
        failed = true;
      }
      assert(failed);
      const after = (await setup.query(
        'select last_updated_at,lease_token from roster.github_sync where workspace_id=$1',
        [w.id],
      )).rows[0];
      assert(
        String(before) === String(after.last_updated_at) && !after.lease_token,
        'Failure preserves cursor and releases lease',
      );
    } finally {
      await cleanupWorkspace(setup, w.id);
      await setup.query('delete from roster.users where subject=$1', [ctx.identity.subject]);
      await runtime.pool.end();
      await setup.end();
    }
  },
});
