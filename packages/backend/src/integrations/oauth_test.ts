import { Pool } from 'npm:pg@8.23.1';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'npm:jose@6.1.3';
import { AppError, type RequestContext } from '../../../contracts/mod.ts';
import { createDatabase } from '../platform/database/client.ts';
import { createIdentityVerifier } from '../platform/auth/jwt.ts';
import { createService } from '../service.ts';
import { cleanupWorkspace, prepareTestDatabase } from '../test_support.ts';
import { createOAuthService, type OAuthUpstream } from './oauth/index.ts';
import { createOAuthRepository } from './oauth/postgres.ts';
import { createHttpApp } from '../transport/http/app.ts';
import { createMcpFetch } from '../transport/mcp/server.ts';
import { createOAuthTransport } from '../transport/oauth/server.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof AppError, String(e));
    return;
  }
  throw new Error('Expected authorization rejection');
}
const url = Deno.env.get('ROSTER_TEST_DATABASE_URL');
Deno.test({
  name:
    'OAuth broker: real JWT and database isolate consent, exchanges, refresh, REST and MCP capabilities',
  ignore: !url,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    assert(url && new URL(url).pathname.endsWith('_test'));
    const setup = new Pool({ connectionString: url });
    await prepareTestDatabase(setup);
    const runtimeUrl = new URL(url);
    runtimeUrl.username = 'roster_test_runtime';
    const runtime = createDatabase(runtimeUrl.toString());
    const service = createService(runtime.db);
    const identity = { subject: crypto.randomUUID(), name: 'Owner', email: 'owner@example.test' };
    const user: RequestContext = { identity, authentication: { kind: 'user' } };
    const clientId = crypto.randomUUID();
    const issuer = 'https://project.supabase.co/auth/v1';
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const jwk = { ...await exportJWK(publicKey), kid: 'test', alg: 'ES256' };
    const verify = createIdentityVerifier({
      issuer,
      audience: 'authenticated',
      jwks: createLocalJWKSet({ keys: [jwk] }),
    });
    async function jwt(
      sessionId: string,
      client: string = clientId,
      subject: string = identity.subject,
    ) {
      return await new SignJWT({
        role: 'authenticated',
        email: identity.email,
        client_id: client,
        session_id: sessionId,
        user_metadata: { workspace: 'forged', access: 'read_write' },
      }).setProtectedHeader({ alg: 'ES256', kid: 'test' }).setIssuer(issuer).setAudience(
        'authenticated',
      ).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    }
    const requests = new Map<string, { code: string; session: string }>();
    let exchangeCalls = 0;
    const upstream: OAuthUpstream = {
      register: async (request) => {
        assert((await request.json()).scope === 'email');
        return Response.json({ client_id: clientId }, { status: 201 });
      },
      authorize: async (params) => {
        assert(!params.get('scope')?.includes('read'), 'Business scopes must not reach Supabase');
        const id = 'upstream' + crypto.randomUUID().replaceAll('-', '').slice(0, 24);
        requests.set(id, { code: crypto.randomUUID(), session: crypto.randomUUID() });
        return new Response(null, {
          status: 302,
          headers: { Location: `https://ui.example/oauth/consent?authorization_id=${id}` },
        });
      },
      code: async (_bearer, id) =>
        `http://localhost/callback?code=${requests.get(id)!.code}&state=csrf`,
      token: async (request) => {
        exchangeCalls++;
        const p = new URLSearchParams(await request.text());
        assert(!p.has('scope'), 'Business scopes must not reach the upstream token endpoint');
        const item = [...requests.values()].find((r) =>
          r.code === p.get('code') || r.session === p.get('refresh_token')
        );
        if (!item) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({
          access_token: await jwt(item.session),
          refresh_token: item.session,
          token_type: 'bearer',
        });
      },
    };
    const repository = createOAuthRepository(runtime.db);
    const oauth = createOAuthService({
      repository,
      upstream,
      verify,
      consentUrl: 'https://ui.example/oauth/consent',
      workspaces: (ctx) => service.listWorkspaces(ctx),
    });
    const transport = createOAuthTransport({
      oauth,
      verify,
      publicUrl: 'https://ui.example',
      resourceUrl: 'https://api',
      allowedOrigins: ['https://ui.example'],
    });
    const tokenRequest = (fields: Record<string, string>) =>
      new Request('https://ui.example/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
    const workspaces = [];
    try {
      for (const name of ['Alpha', 'Beta']) {
        workspaces.push(
          await service.createWorkspace(user, { slug: `oauth-${crypto.randomUUID()}`, name }),
        );
      }
      const [a, b] = workspaces;
      for (const w of workspaces) {
        await service.createTeam(user, w.slug, {
          key: 'TE',
          name: 'Team',
        });
      }
      const authorize = async (scope: string) => {
        const r = await oauth.authorize(
          new URLSearchParams({
            client_id: clientId,
            redirect_uri: 'http://localhost/callback',
            response_type: 'code',
            scope,
            state: 'csrf',
          }),
        );
        return new URL(r.headers.get('Location')!).searchParams.get('authorization_id')!;
      };
      const registration = await oauth.register(
        new Request('https://ui.example/oauth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_name: 'Client',
            redirect_uris: ['http://localhost/callback'],
            scope: 'read write',
          }),
        }),
      );
      assert(registration.status === 201 && (await registration.json()).scope === 'read write');
      const aid = await authorize('read'), bid = await authorize('read write');
      assert(aid.length === 32 && !aid.includes('-'));
      const browserToken = await new SignJWT({ role: 'authenticated', email: identity.email })
        .setProtectedHeader({ alg: 'ES256', kid: 'test' }).setIssuer(issuer).setAudience(
          'authenticated',
        )
        .setSubject(identity.subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
      const detailsResponse = await transport(
        new Request(`https://ui.example/api/oauth/authorizations/${aid}`, {
          headers: { Authorization: `Bearer ${browserToken}` },
        }),
      );
      assert(detailsResponse.status === 200, await detailsResponse.clone().text());
      assert((await detailsResponse.json()).id === aid);

      assert((await oauth.details(user, aid)).access === 'read');
      await rejects(() => oauth.approve(user, 'Bearer web', aid, a.slug, 'read_write'));
      // Approve and exchange in the opposite order; neither chooses a "latest" grant.
      await oauth.approve(user, 'Bearer web', bid, b.slug, 'read_write');
      const approvalResponse = await transport(
        new Request(`https://ui.example/api/oauth/authorizations/${aid}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${browserToken}`,
            Origin: 'https://ui.example',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ workspace: a.slug, access: 'read' }),
        }),
      );
      assert(approvalResponse.status === 200, await approvalResponse.clone().text());

      await rejects(() => oauth.approve(user, 'Bearer web', aid, b.slug, 'read'));
      const bTokens = await (await oauth.token(
        tokenRequest({ grant_type: 'authorization_code', code: requests.get(bid)!.code }),
      )).json();
      const aTokens = await (await oauth.token(
        tokenRequest({ grant_type: 'authorization_code', code: requests.get(aid)!.code }),
      )).json();
      assert(aTokens.scope === 'read' && bTokens.scope === 'read write');
      const actor = async (t: string) =>
        await verify(new Request('https://api', { headers: { Authorization: `Bearer ${t}` } }));
      assert((await oauth.context(await actor(aTokens.access_token))).workspace === a.slug);
      assert((await oauth.context(await actor(bTokens.access_token))).workspace === b.slug);
      const refreshed = await (await oauth.token(
        tokenRequest({ grant_type: 'refresh_token', refresh_token: aTokens.refresh_token }),
      )).json();
      assert((await oauth.context(await actor(refreshed.access_token))).workspace === a.slug);
      const before = exchangeCalls;
      await rejects(() =>
        oauth.token(
          tokenRequest({ grant_type: 'authorization_code', code: requests.get(aid)!.code }),
        )
      );
      await rejects(() =>
        oauth.token(tokenRequest({ grant_type: 'authorization_code', code: 'unknown' }))
      );
      assert(exchangeCalls === before, 'Unknown/replayed code must fail before upstream exchange');
      await rejects(() => oauth.context(user));
      await rejects(async () => oauth.context(await actor(await jwt(crypto.randomUUID()))));
      await rejects(async () =>
        oauth.context(await actor(await jwt(requests.get(aid)!.session, crypto.randomUUID())))
      );
      const rest = createHttpApp({ service, verify, allowedOrigins: [] });
      for (const method of ['GET', 'POST']) {
        const response = await rest.request(
          new Request(`https://api/api/w/${a.slug}/issues`, {
            method,
            headers: {
              Authorization: `Bearer ${aTokens.access_token}`,
              'Content-Type': 'application/json',
            },
            ...(method === 'POST'
              ? { body: JSON.stringify({ team: 'TE', title: 'Forbidden' }) }
              : {}),
          }),
        );
        assert(response.status === 403, 'OAuth token must not bypass MCP using REST');
      }
      const mcp = createMcpFetch({
        service,
        verify,
        authorize: (ctx) => oauth.context(ctx),
        publicUrl: 'https://api',
        authorizationServer: 'https://ui.example',
        allowedOrigins: [],
      });
      const rpc = async (t: string, path: string, method: string, params: unknown = {}) => {
        const response = await mcp(
          new Request(`https://api${path}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${t}`,
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          }),
        );
        const text = await response.text();
        const line = text.split('\n').find((l) => l.startsWith('data: '));
        return { status: response.status, data: JSON.parse(line ? line.slice(6) : text) };
      };
      const tools = await rpc(aTokens.access_token, '/mcp', 'tools/list');
      const names = tools.data.result.tools.map((t: { name: string }) => t.name);
      assert(
        names.includes('whoami') && !names.includes('create_issue') &&
          !names.includes('list_workspaces'),
      );
      const who = await rpc(aTokens.access_token, '/mcp', 'tools/call', {
        name: 'whoami',
        arguments: {},
      });
      assert(who.data.result.structuredContent.result.workspace.slug === a.slug);
      const blocked = await rpc(aTokens.access_token, '/mcp', 'tools/call', {
        name: 'create_issue',
        arguments: { team: 'TE', title: 'Forbidden' },
      });
      assert(blocked.data.error || blocked.data.result?.isError);
      assert((await service.listIssues(user, a.slug)).issues.length === 0);
      assert((await rpc(aTokens.access_token, `/w/${b.slug}/mcp`, 'tools/list')).status === 403);
      const readonly = await rpc(bTokens.access_token, '/mcp/readonly', 'tools/list');
      assert(!readonly.data.result.tools.some((t: { name: string }) => t.name === 'create_issue'));
      const write = await rpc(bTokens.access_token, '/mcp', 'tools/call', {
        name: 'create_issue',
        arguments: { team: 'TE', title: 'Authorized' },
      });
      assert(!write.data.result.isError, JSON.stringify(write));
      assert((await service.listIssues(user, b.slug)).issues.length === 1);
      const racedId = await authorize('read write');
      const raced = await Promise.allSettled([
        oauth.approve(user, 'Bearer web', racedId, a.slug, 'read'),
        oauth.approve(user, 'Bearer web', racedId, b.slug, 'read_write'),
      ]);
      assert(
        raced.filter((r) => r.status === 'fulfilled').length === 1,
        'One request can only be approved once',
      );
      assert((await oauth.context(await actor(aTokens.access_token))).workspace === a.slug);
      assert((await oauth.context(await actor(bTokens.access_token))).workspace === b.slug);
      const expiredId = await authorize('read');
      await setup.query(
        "update roster.oauth_authorizations set expires_at=now()-interval '1 second' where id=$1",
        [expiredId],
      );
      await rejects(() => oauth.approve(user, 'Bearer web', expiredId, a.slug, 'read'));
      const deniedId = await authorize('read write');
      const denied = await oauth.deny(user, deniedId);
      assert(new URL(denied.redirect_url).searchParams.get('error') === 'access_denied');
      assert(new URL(denied.redirect_url).searchParams.get('state') === 'csrf');
      await rejects(() => oauth.approve(user, 'Bearer web', deniedId, a.slug, 'read'));
      const metadata = await (await transport(
        new Request('https://ui.example/.well-known/oauth-authorization-server'),
      )).json();
      assert(metadata.token_endpoint === 'https://ui.example/oauth/token');
      const badTarget = await transport(
        new Request('https://ui.example/oauth/authorize?resource=https://evil.example/mcp'),
      );
      assert(badTarget.status === 400);
      const badClient = await jwt(requests.get(aid)!.session, 'not-a-uuid');
      await rejects(() => actor(badClient));
      await setup.query('update roster.oauth_grants set revoked_at=now() where session_id=$1', [
        requests.get(aid)!.session,
      ]);
      await rejects(async () => oauth.context(await actor(aTokens.access_token)));
      // Existing grants never replace the current membership check.
      await setup.query(
        "update roster.workspace_members set status='suspended' where workspace_id=$1 and subject=$2",
        [b.id, identity.subject],
      );
      await rejects(async () => oauth.context(await actor(bTokens.access_token)));
      await rejects(() =>
        oauth.token(
          tokenRequest({ grant_type: 'refresh_token', refresh_token: bTokens.refresh_token }),
        )
      );
    } finally {
      for (const w of workspaces) await cleanupWorkspace(setup, w.id);
      await setup.query('delete from roster.oauth_authorizations where client_id=$1', [clientId]);
      await setup.query('delete from roster.users where subject=$1', [identity.subject]);
      await runtime.pool.end();
      await setup.end();
    }
  },
});

Deno.test('Supabase adapter handles first consent and auto-approval without following a client redirect', async () => {
  const { createOAuthUpstream } = await import('./oauth/infrastructure/upstream.ts');
  const calls: { path: string; method: string; origin: string | null }[] = [];
  let auto = false;
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    calls.push({ path, method: init?.method ?? 'GET', origin: headers.get('Origin') });
    assert(init?.redirect === 'manual');
    if (path.endsWith('/consent')) {
      assert(JSON.parse(String(init?.body)).action === 'approve');
      return Response.json({ redirect_url: 'http://localhost/callback?code=first' });
    }
    if (path.includes('/authorizations/')) {
      assert(headers.get('Authorization') === 'Bearer web');
      return Response.json(
        auto
          ? { redirect_url: 'http://localhost/callback?code=auto' }
          : { authorization_id: 'request', client: { id: 'client' } },
      );
    }
    if (path.endsWith('/token')) {
      assert(headers.get('Authorization') === 'Basic client');
      assert(
        await new Response(init?.body).text() === 'grant_type=refresh_token&refresh_token=opaque',
      );
      return Response.json({ access_token: 'token' });
    }
    return Response.json({ client_id: 'client' });
  };
  const upstream = createOAuthUpstream(
    'https://project.supabase.co/auth/v1',
    'https://ui.example',
    fetcher,
  );
  assert((await upstream.code('Bearer web', 'first')).includes('code=first'));
  const firstCount = calls.length;
  assert(firstCount === 2 && calls[1].path.endsWith('/consent'));
  auto = true;
  assert((await upstream.code('Bearer web', 'auto')).includes('code=auto'));
  assert(calls.length === 3, 'Auto-approval must not approve the request again');
  assert(calls.every((c) => c.origin === 'https://ui.example'));
  await upstream.token(
    new Request('https://ui.example/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic client',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=refresh_token&refresh_token=opaque',
    }),
  );
  await upstream.register(
    new Request('https://ui.example/oauth/register', { method: 'POST', body: '{}' }),
  );
  assert(calls.at(-1)?.path === '/auth/v1/oauth/clients/register');
});

Deno.test({
  name: 'Opaque authorization ID migration preserves earlier UUID-shaped broker requests',
  ignore: !url,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    assert(url && new URL(url).pathname.endsWith('_test'));
    const pool = new Pool({ connectionString: url });
    await prepareTestDatabase(pool);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'alter table roster.oauth_authorizations alter column id type uuid using id::uuid',
      );
      const id = crypto.randomUUID();
      await client.query(
        "insert into roster.oauth_authorizations(id,client_id,redirect_uri,access) values($1,$2,'http://localhost/callback','read')",
        [id, crypto.randomUUID()],
      );
      await client.query(
        await Deno.readTextFile(
          new URL(
            '../../../../supabase/migrations/20261117090655_oauth_authorization_opaque_ids.sql',
            import.meta.url,
          ),
        ),
      );
      const row = await client.query(
        'select id,pg_typeof(id)::text as type from roster.oauth_authorizations where id=$1',
        [id],
      );
      assert(row.rows[0].id === id && row.rows[0].type === 'text');
    } finally {
      await client.query('rollback');
      client.release();
      await pool.end();
    }
  },
});
