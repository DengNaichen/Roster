import { Pool } from 'npm:pg@8.23.1';
import { generateKeyPairSync } from 'node:crypto';
import { importSPKI, jwtVerify } from 'npm:jose@6.1.3';
import { createDatabase } from '../platform/database/client.ts';
import { createService } from '../service.ts';
import { cleanupWorkspace, prepareTestDatabase } from '../test_support.ts';
import { githubWebhook, identifiers, parseBindings, type Pull } from './github/index.ts';
import { bindingKey, closingReferences, type Delivery } from './github/application/model.ts';
import { createGitHubClient, createGitHubIntegration } from './github/postgres.ts';
import { createUnitOfWork } from '../platform/database/session.ts';
const assert: (v: unknown, m?: string) => void = (v, m = 'Assertion failed') => {
  if (!v) throw new Error(m);
};
async function signed(
  body: unknown,
  id: string = crypto.randomUUID(),
  event = 'pull_request',
  secret = 'secret',
) {
  const bytes = typeof body === 'string' ? body : JSON.stringify(body);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = Array.from(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bytes))),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
  return new Request('https://app/webhook', {
    method: 'POST',
    body: bytes,
    headers: {
      'x-hub-signature-256': `sha256=${sig}`,
      'x-github-delivery': id,
      'x-github-event': event,
    },
  });
}
let envelopeSequence = 0;
const envelope = (number = 1, action = 'opened', repository = 222, installation = 111) => ({
  action,
  installation: { id: installation },
  repository: { id: repository },
  pull_request: { number, updated_at: new Date(Date.now() + envelopeSequence++).toISOString() },
});
Deno.test('GitHub configuration rejects ambiguous authority and closing references are explicit', () => {
  assert(JSON.stringify(identifiers('al-1 AL-1 feature/AL-2 XX-7', ['AL'])) === '["AL-1","AL-2"]');
  const b = { workspace: 'demo', repo: 'owner/repo', installationId: 1, repositoryId: 2 };
  assert(parseBindings(JSON.stringify([b]))[0].completion === 'manual');
  for (
    const input of [
      [{ workspace: 'demo', repo: 'owner/repo' }],
      [b, { ...b, workspace: 'other' }],
      [{ ...b, repositoryId: Number.MAX_SAFE_INTEGER + 1 }],
      [{ ...b, repo: '../private/token' }],
    ]
  ) {
    let rejected = false;
    try {
      parseBindings(JSON.stringify(input));
    } catch {
      rejected = true;
    }
    assert(rejected, 'Unsafe configuration rejected');
  }
  assert(closingReferences('Fixes AL-1; resolves al-2. Mentions AL-3', ['AL']).size === 2);
});
Deno.test('Webhook authenticates bounded bytes and persists a validated delivery before acknowledgment', async () => {
  const accepted: Delivery[] = [];
  let fail = false;
  const handler = githubWebhook({
    accept: async (d) => {
      if (fail) throw new Error('database unavailable');
      accepted.push(d);
      return d.repositoryId === 222;
    },
  }, 'secret');
  assert((await handler(new Request('https://app/webhook'))).status === 405);
  const bad = await signed(envelope());
  bad.headers.set('x-hub-signature-256', 'sha256=' + '0'.repeat(64));
  assert((await handler(bad)).status === 401 && accepted.length === 0);
  assert((await handler(await signed(envelope()))).status === 202 && accepted.length === 1);
  assert((await handler(await signed(envelope(), 'invalid'))).status === 400);
  assert((await handler(await signed('{'))).status === 400);
  assert((await handler(await signed(envelope(1, 'labeled')))).status === 204);
  assert((await handler(await signed(envelope(), undefined, 'ping'))).status === 204);
  assert((await handler(await signed(envelope(1, 'opened', 333)))).status === 204);
  fail = true;
  assert((await handler(await signed(envelope()))).status === 503);
  assert(
    (await handler(
      new Request('https://app/webhook', { method: 'POST', body: 'x'.repeat(1_048_577) }),
    )).status === 413,
  );
});
function fakeGitHub() {
  let clock = Date.now() + 10_000;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const app = {
    appId: 'test-app',
    privateKey: String(privateKey.export({ type: 'pkcs1', format: 'pem' })),
  };
  const verification = importSPKI(
    String(publicKey.export({ type: 'spki', format: 'pem' })),
    'RS256',
  );
  let pulls: Pull[] = [];
  let failure: number | null = null;
  let tokenCount = 0;
  let wrongRepository = false;
  let pullHook: (() => Promise<void>) | undefined;
  const calls: string[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path + new URL(String(input)).search);
    const authorization = new Headers(init?.headers).get('authorization') ?? '';
    if (path === '/app/installations/111/access_tokens') {
      const jwt = await jwtVerify(authorization.slice(7), await verification, {
        issuer: 'test-app',
        algorithms: ['RS256'],
        currentDate: new Date(clock),
      });
      assert(jwt.payload.iat === Math.floor(clock / 1000) - 60);
      assert(Number(jwt.payload.exp) <= Math.floor(clock / 1000) + 600);
      const body = JSON.parse(String(init?.body));
      assert(body.repository_ids.length === 1 && body.repository_ids[0] === 222);
      assert(body.permissions.pull_requests === 'read' && body.permissions.metadata === 'read');
      tokenCount++;
      return Response.json({
        token: `installation-${tokenCount}`,
        expires_at: new Date(clock + 3600_000).toISOString(),
      });
    }
    assert(
      authorization.startsWith('Bearer installation-'),
      'Only installation tokens reach repository APIs',
    );
    if (failure) {
      return new Response(null, {
        status: failure,
        headers: failure === 429 ? { 'retry-after': '120' } : {},
      });
    }
    if (path === '/repos/owner/repo') {
      return Response.json({ id: wrongRepository ? 333 : 222, full_name: 'owner/repo' });
    }
    if (path === '/repos/owner/repo/pulls') {
      const page = Number(new URL(String(input)).searchParams.get('page'));
      return Response.json(
        [...pulls].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(
          (page - 1) * 100,
          page * 100,
        ),
      );
    }
    const p = pulls.find((p) => path === `/repos/owner/repo/pulls/${p.number}`);
    const response = p ? Response.json(p) : new Response(null, { status: 404 });
    const hook = pullHook;
    pullHook = undefined;
    if (hook) await hook();
    return response;
  };
  return {
    app,
    fetch: fetchMock,
    now: () => clock,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
    fail: (status: number | null) => {
      failure = status;
    },
    mismatch: (value: boolean) => {
      wrongRepository = value;
    },
    tokenCount: () => tokenCount,
    onPull: (hook: () => Promise<void>) => {
      pullHook = hook;
    },
    set: (value: Pull[]) => {
      pulls = value;
    },
    pull: (
      number: number,
      title: string,
      state: 'open' | 'closed' = 'open',
      merged = false,
    ): Pull => ({
      number,
      title,
      body: null,
      state,
      draft: false,
      merged_at: merged ? new Date(clock).toISOString() : null,
      updated_at: new Date(clock).toISOString(),
      head: { ref: `feature/${title}` },
      base: { repo: { id: 222 } },
    }),
  };
}
Deno.test('GitHub App signs PKCS1 keys, scopes tokens and coalesces expiry refreshes', async () => {
  const fake = fakeGitHub();
  const b = parseBindings(
    '[{"workspace":"demo","repo":"owner/repo","installationId":111,"repositoryId":222}]',
  )[0];
  const client = createGitHubClient(fake);
  await Promise.all([client.verify(b), client.verify(b)]);
  assert(fake.tokenCount() === 1, 'Concurrent token mint coalesced');
  fake.advance(3600_000);
  await Promise.all([client.verify(b), client.verify(b)]);
  assert(fake.tokenCount() === 2, 'Expired token renewed');
  fake.mismatch(true);
  let denied = false;
  try {
    await client.verify(b);
  } catch {
    denied = true;
  }
  assert(denied, 'Repository ID mismatch rejected');
});
const url = Deno.env.get('ROSTER_INTEGRATIONS_TEST_DATABASE_URL');
async function harness(completion: 'manual' | 'closing_reference' = 'manual') {
  const setup = new Pool({ connectionString: url, max: 3 });
  await prepareTestDatabase(setup);
  const runtimeUrl = new URL(url!);
  runtimeUrl.username = 'roster_test_runtime';
  const runtime = createDatabase(runtimeUrl.toString());
  const service = createService(runtime.db);
  const ctx = {
    identity: { subject: crypto.randomUUID(), name: 'Sync tester', email: 'sync@test.local' },
  };
  const w = await service.createWorkspace(ctx, {
    slug: 'gh-' + crypto.randomUUID(),
    name: 'GitHub tests',
  });
  await service.createTeam(ctx, w.slug, { key: 'AA', name: 'Public' });
  const issue = await service.createIssue(ctx, w.slug, {
    team: 'AA',
    title: 'Accept after review',
    status: 'todo',
  });
  const fake = fakeGitHub();
  const binding = parseBindings(
    JSON.stringify([{
      workspace: w.slug,
      repo: 'owner/repo',
      installationId: 111,
      repositoryId: 222,
      completion,
    }]),
  )[0];
  const create = () => createGitHubIntegration(runtime.db, { ...fake, bindings: [binding] });
  const github = create();
  const webhook = githubWebhook(github, 'secret');
  const detail = () => service.getIssue(ctx, w.slug, issue.identifier);
  async function close() {
    await cleanupWorkspace(setup, w.id);
    await setup.query('delete from roster.users where subject=$1', [ctx.identity.subject]);
    await runtime.pool.end();
    await setup.end();
  }
  return {
    setup,
    runtime,
    service,
    ctx,
    w,
    issue,
    fake,
    binding,
    github,
    webhook,
    create,
    detail,
    close,
  };
}
Deno.test({
  name:
    'Signed webhook survives restart, deduplicates, targets one PR and waits for acceptance by default',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = await harness();
    try {
      h.fake.set([h.fake.pull(1, h.issue.identifier, 'closed', true)]);
      assert(!(await h.github.run()).some((r) => r.error));
      assert((await h.detail()).status === 'todo', 'Historical merged PR cannot complete task');
      assert((await h.detail()).pull_requests.length === 1);
      const beforeIdle = h.fake.calls.length;
      await h.github.run();
      assert(
        h.fake.calls.length === beforeIdle,
        'No polling when queue empty and reconciliation not due',
      );
      h.fake.advance(1000);
      h.fake.set([h.fake.pull(1, h.issue.identifier)]);
      const id = crypto.randomUUID();
      const before = h.fake.calls.length;
      assert((await h.webhook(await signed(envelope(), id))).status === 202);
      assert((await h.webhook(await signed(envelope(), id))).status === 202);
      assert(h.fake.calls.length === before, 'Ingress performs no GitHub HTTP');
      assert(
        (await h.setup.query(
          'select count(*)::int n from roster.github_deliveries where workspace_id=$1',
          [h.w.id],
        )).rows[0].n === 1,
      );
      const reports = await Promise.all([h.create().run(), h.create().run()]);
      assert(
        reports.flat().reduce((n, r) => n + (r.processed ?? 0), 0) === 1,
        'Only lease owner processes delivery',
      );
      assert((await h.detail()).status === 'in_review');
      assert(
        !h.fake.calls.slice(before).some((p) => p.includes('/pulls?')),
        'Event targets canonical PR only',
      );
      h.fake.advance(1000);
      h.fake.set([h.fake.pull(1, h.issue.identifier, 'closed', true)]);
      await h.webhook(await signed(envelope(1, 'closed')));
      await h.github.run();
      assert((await h.detail()).status === 'in_review', 'Default requires human acceptance');
      const audits = (await h.setup.query(
        'select count(*)::int n from roster.audit_events where workspace_id=$1',
        [h.w.id],
      )).rows[0].n;
      await h.webhook(await signed(envelope(), id));
      await h.github.run();
      assert(
        (await h.setup.query(
          'select count(*)::int n from roster.audit_events where workspace_id=$1',
          [h.w.id],
        )).rows[0].n === audits,
      );
      const count = (await h.setup.query(
        'select count(*)::int n from roster.github_deliveries where workspace_id=$1',
        [h.w.id],
      )).rows[0].n;
      assert((await h.webhook(await signed(envelope(1, 'opened', 222, 999)))).status === 204);
      assert(
        (await h.setup.query(
          'select count(*)::int n from roster.github_deliveries where workspace_id=$1',
          [h.w.id],
        )).rows[0].n === count,
      );
    } finally {
      await h.close();
    }
  },
});
Deno.test({
  name:
    'Explicit completion checks closing intent, multiple PRs and stale facts; title edits remove links',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = await harness('closing_reference');
    try {
      await h.github.run();
      const p1 = h.fake.pull(1, `Fixes ${h.issue.identifier}`);
      const p2 = h.fake.pull(2, h.issue.identifier);
      h.fake.set([p1, p2]);
      await h.webhook(await signed(envelope(1)));
      await h.webhook(await signed(envelope(2)));
      await h.github.run();
      h.fake.advance(1000);
      h.fake.set([h.fake.pull(1, p1.title, 'closed', true), p2]);
      await h.webhook(await signed(envelope(1, 'closed')));
      await h.github.run();
      assert((await h.detail()).status === 'in_review', 'Other open PR blocks completion');
      h.fake.advance(1000);
      const merged2 = h.fake.pull(2, p2.title, 'closed', true);
      h.fake.set([h.fake.pull(1, p1.title, 'closed', true), merged2]);
      await h.webhook(await signed(envelope(2, 'closed')));
      await h.github.run();
      assert((await h.detail()).status === 'done');
      // An old open delivery re-fetches current merged facts, so it cannot regress the projection.
      await h.webhook(await signed(envelope(2, 'opened')));
      await h.github.run();
      assert((await h.detail()).pull_requests.every((p) => p.state === 'merged'));
      h.fake.set([p2]); // Even an older remote snapshot cannot overwrite newer persisted facts.
      await h.webhook(await signed(envelope(2)));
      await h.github.run();
      assert((await h.detail()).pull_requests.find((p) => p.number === 2)?.state === 'merged');
      h.fake.advance(1000);
      h.fake.set([h.fake.pull(2, 'Unrelated change')]);
      await h.webhook(await signed(envelope(2, 'edited')));
      await h.github.run();
      assert((await h.detail()).pull_requests.length === 1, 'Removed identifier is unlinked');
      assert((await h.detail()).status === 'done', 'Terminal tasks never regress');
    } finally {
      await h.close();
    }
  },
});
Deno.test({
  name:
    'Failures back off durably, rate limits delay retries, attempts exhaust and dedupe preserves dead outcome',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = await harness();
    try {
      await h.github.run();
      const id = crypto.randomUUID();
      h.fake.set([h.fake.pull(1, h.issue.identifier)]);
      await h.webhook(await signed(envelope(), id));
      h.fake.fail(429);
      assert((await h.github.run())[0].retried === 1);
      const failed =
        (await h.setup.query('select * from roster.github_deliveries where workspace_id=$1', [
          h.w.id,
        ])).rows[0];
      assert(failed.attempts === 1 && failed.available_at.getTime() >= h.fake.now() + 120_000);
      const calls = h.fake.calls.length;
      await h.github.run();
      assert(h.fake.calls.length === calls, 'No calls during backoff');
      h.fake.fail(null);
      h.fake.advance(121_000);
      await h.create().run();
      assert((await h.detail()).pull_requests.length === 1);
      const deadId = crypto.randomUUID();
      await h.webhook(await signed(envelope(), deadId));
      await h.setup.query('update roster.github_deliveries set attempts=7 where delivery_id=$1', [
        deadId,
      ]);
      h.fake.fail(503);
      await h.github.run();
      await h.webhook(await signed(envelope(), deadId));
      const dead = (await h.setup.query(
        'select outcome,attempts from roster.github_deliveries where delivery_id=$1',
        [deadId],
      )).rows[0];
      assert(dead.outcome === 'dead' && dead.attempts === 8);
      assert((await h.detail()).status === 'in_review', 'Failure cannot modify issue status');
    } finally {
      await h.close();
    }
  },
});
Deno.test({
  name: 'Repository lease fences expired workers and binding replacements',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = await harness();
    try {
      await h.github.run();
      const db = createUnitOfWork(h.runtime.db);
      const a = {
        workspaceId: String(h.w.id),
        repo: h.binding.repo,
        key: bindingKey(h.binding),
        lease: crypto.randomUUID(),
      };
      const b = { ...a, lease: crypto.randomUUID() };
      assert(await db.github.claim(a));
      assert(!await db.github.claim(b));
      await h.setup.query(
        "update roster.github_sync set lease_until=now()-interval '1 second' where workspace_id=$1",
        [h.w.id],
      );
      assert(await db.github.claim(b));
      assert(!await db.github.owned(a));
      await db.github.release(a);
      assert(await db.github.owned(b), 'Stale release cannot clear new owner');
      let mismatch = false;
      try {
        await db.github.configure({
          workspaceId: a.workspaceId,
          binding: h.binding,
          key: 'changed',
        });
      } catch {
        mismatch = true;
      }
      assert(mismatch && await db.github.owned(b), 'Stale config cannot replace active binding');
      await h.setup.query(
        'update roster.github_sync set binding_key=null,lease_token=null,lease_until=null where workspace_id=$1',
        [h.w.id],
      );
      await db.github.configure({ workspaceId: a.workspaceId, binding: h.binding, key: 'changed' });
      assert(!await db.github.owned(b), 'Binding change fences in-flight worker');
    } finally {
      await h.close();
    }
  },
});
Deno.test({
  name:
    'Full import checkpoints across jobs and reconciliation recovers a missed merge without replaying history',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = await harness();
    try {
      const pulls = Array.from(
        { length: 101 },
        (_, i) => h.fake.pull(i + 1, h.issue.identifier, 'closed', true),
      );
      h.fake.set(pulls);
      await h.github.run();
      const partial = (await h.setup.query(
        'select scan,initialized_at,last_updated_at from roster.github_sync where workspace_id=$1',
        [h.w.id],
      )).rows[0];
      assert(
        partial.scan.page === 2 && partial.initialized_at === null &&
          partial.last_updated_at === null,
      );
      h.fake.fail(503);
      await h.github.run();
      assert((await h.detail()).status === 'todo');
      h.fake.fail(null);
      h.fake.advance(901_000);
      await h.create().run();
      assert(
        (await h.detail()).pull_requests.length === 101 && (await h.detail()).status === 'todo',
      );
      h.fake.advance(6 * 3600_000 + 1000);
      h.fake.set([h.fake.pull(1, h.issue.identifier), ...pulls.slice(1)]);
      await h.github.run();
      assert(
        (await h.detail()).status === 'in_review',
        'Periodic reconciliation recovers missed webhook',
      );
    } finally {
      await h.close();
    }
  },
});
Deno.test({
  name: 'PR bursts coalesce while a delivery arriving during fetch remains pending',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = await harness();
    try {
      await h.github.run();
      h.fake.set([h.fake.pull(1, h.issue.identifier), h.fake.pull(2, h.issue.identifier)]);
      const replay = envelope(1);
      for (let i = 0; i < 25; i++) await h.webhook(await signed(replay));
      await h.webhook(await signed(envelope(2)));
      h.fake.onPull(async () => {
        h.fake.advance(1000);
        h.fake.set([
          h.fake.pull(1, h.issue.identifier, 'closed', true),
          h.fake.pull(2, h.issue.identifier),
        ]);
        await h.webhook(await signed(envelope(1, 'closed')));
      });
      const start = h.fake.calls.length;
      await h.github.run();
      assert(
        h.fake.calls.slice(start).filter((p) => p === '/repos/owner/repo/pulls/1').length === 1,
      );
      assert(
        h.fake.calls.slice(start).filter((p) => p === '/repos/owner/repo/pulls/2').length === 1,
      );
      assert(
        (await h.setup.query(
          'select count(*)::int n from roster.github_deliveries where workspace_id=$1 and completed_at is null',
          [h.w.id],
        )).rows[0].n === 1,
        'A newer delivery cannot be acknowledged by an older fetch',
      );
      await h.create().run();
      assert((await h.detail()).pull_requests.find((p) => p.number === 1)?.state === 'merged');
    } finally {
      await h.close();
    }
  },
});
Deno.test({
  name:
    'Live deliveries wait through initial import and then advance once despite unchanged imported facts',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = await harness();
    try {
      h.fake.set(Array.from({ length: 101 }, (_, i) => h.fake.pull(i + 1, h.issue.identifier)));
      await h.webhook(await signed(envelope(1)));
      await h.github.run();
      await h.create().run();
      assert((await h.detail()).status === 'todo', 'Import never mutates task status');
      assert(
        (await h.setup.query('select outcome from roster.github_deliveries where workspace_id=$1', [
          h.w.id,
        ])).rows[0].outcome === null,
      );
      await h.create().run();
      assert((await h.detail()).status === 'in_review', 'Deferred live event is not lost');
      await h.service.updateIssue(h.ctx, h.w.slug, h.issue.identifier, { status: 'todo' });
      await h.webhook(await signed(envelope(1, 'synchronize')));
      await h.github.run();
      assert(
        (await h.detail()).status === 'todo',
        'Unchanged repeat facts respect manual status edits',
      );
    } finally {
      await h.close();
    }
  },
});
Deno.test({
  name:
    'Aggregate completion handles unmerged sibling closure and excludes historic closing merges',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = await harness('closing_reference');
    try {
      const historic = h.fake.pull(1, `Fixes ${h.issue.identifier}`, 'closed', true);
      historic.merged_at = new Date(h.fake.now() - 60_000).toISOString();
      h.fake.set([historic]);
      await h.github.run();
      h.fake.advance(1000);
      h.fake.set([historic, h.fake.pull(2, h.issue.identifier, 'closed', true)]);
      await h.webhook(await signed(envelope(2, 'closed')));
      await h.github.run();
      assert(
        (await h.detail()).status === 'in_review',
        'Historic closing intent cannot complete a new merge',
      );
      h.fake.set([
        historic,
        h.fake.pull(2, h.issue.identifier),
        h.fake.pull(3, `Fixes ${h.issue.identifier}`),
      ]);
      await h.webhook(await signed(envelope(2, 'reopened')));
      await h.webhook(await signed(envelope(3)));
      await h.github.run();
      h.fake.advance(1000);
      h.fake.set([
        historic,
        h.fake.pull(2, h.issue.identifier),
        h.fake.pull(3, `Fixes ${h.issue.identifier}`, 'closed', true),
      ]);
      await h.webhook(await signed(envelope(3, 'closed')));
      await h.github.run();
      assert((await h.detail()).status === 'in_review');
      h.fake.advance(1000);
      h.fake.set([
        historic,
        h.fake.pull(2, h.issue.identifier, 'closed'),
        h.fake.pull(3, `Fixes ${h.issue.identifier}`, 'closed', true),
      ]);
      await h.webhook(await signed(envelope(2, 'closed')));
      await h.github.run();
      assert(
        (await h.detail()).status === 'done',
        'Sibling closure re-evaluates eligible closing merge',
      );
    } finally {
      await h.close();
    }
  },
});
