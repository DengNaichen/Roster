import { Pool } from 'npm:pg@8.23.1';
import { AppError, type RequestContext } from '../../../contracts/mod.ts';
import { createDatabase } from '../platform/database/client.ts';
import { createService } from '../service.ts';
import { cleanupWorkspace, prepareTestDatabase } from '../test_support.ts';
import { createHttpApp } from '../transport/http/app.ts';
import { createMcpFetch } from '../transport/mcp/server.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    assert(e instanceof AppError, String(e));
    return;
  }
  throw new Error('Expected rejection');
}
const url = Deno.env.get('ROSTER_TEST_DATABASE_URL');
Deno.test({
  name:
    'Workspace creation atomically establishes its public team and owner, supports REST/MCP, and preserves existing workspaces',
  ignore: !url,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    assert(url && new URL(url).pathname.endsWith('_test'));
    const admin = new Pool({ connectionString: url });
    await prepareTestDatabase(admin);
    const runtimeUrl = new URL(url);
    runtimeUrl.username = 'roster_test_runtime';
    const runtime = createDatabase(runtimeUrl.toString()), s = createService(runtime.db);
    const ctx: RequestContext = {
      identity: { subject: crypto.randomUUID(), name: 'Creator', email: 'creator@example.test' },
    };
    const workspaces = [];
    try {
      const slug = `default-${crypto.randomUUID()}`;
      const w = await s.createWorkspace(ctx, { slug, name: 'Studio Sandbox', team_key: 'STU' });
      workspaces.push(w);
      assert(w.default_team_key === 'STU');
      const teams = await s.listTeams(ctx, slug);
      assert(teams.length === 1);
      const team = teams[0];
      assert(
        team.name === w.name && team.key === 'STU' && !team.private && team.joined &&
          team.can_manage,
      );
      const members = await s.listTeamMembers(ctx, slug, 'STU');
      assert(
        members.length === 1 && members[0].subject === ctx.identity.subject &&
          members[0].role === 'owner',
      );
      await rejects(() => s.createWorkspace(ctx, { slug, name: 'Duplicate' }));
      assert(
        (await s.listTeams(ctx, slug)).length === 1,
        'A conflicting request must not duplicate the team',
      );
      const existing = await s.createWorkspace(ctx, {
        slug: `default-${crypto.randomUUID()}`,
        name: '研发',
      });
      workspaces.push(existing);
      assert(/^[A-Z][A-Z0-9]{1,5}$/.test(existing.default_team_key));
      await admin.query('delete from roster.team_members where workspace_id=$1', [existing.id]);
      await admin.query('delete from roster.teams where workspace_id=$1', [existing.id]);
      await s.updateWorkspace(ctx, existing.slug, { name: 'Existing workspace renamed' });
      assert(
        (await s.listTeams(ctx, existing.slug)).length === 0,
        'Existing workspaces must not be backfilled',
      );
      const failedSlug = `default-${crypto.randomUUID()}`;
      await admin.query(
        "alter table roster.teams add constraint test_default_team_failure check(key<>'FAIL')",
      );
      try {
        await rejects(() =>
          s.createWorkspace(ctx, { slug: failedSlug, name: 'Failure', team_key: 'FAIL' })
        );
      } finally {
        await admin.query('alter table roster.teams drop constraint test_default_team_failure');
      }
      assert(
        (await admin.query('select 1 from roster.workspaces where slug=$1', [failedSlug])).rows
          .length === 0,
        'Team failure must roll back the workspace and membership',
      );
      await rejects(() =>
        s.createWorkspace(ctx, { slug: failedSlug, name: 'Invalid', team_key: 'x' })
      );
      const rest = createHttpApp({ service: s, verify: async () => ctx, allowedOrigins: [] });
      const restSlug = `default-${crypto.randomUUID()}`;
      const response = await rest.request('https://api/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: restSlug, name: 'REST Workspace', team_key: 'RW' }),
      });
      assert(response.status === 201);
      const created = await response.json();
      workspaces.push(created);
      assert(created.default_team_key === 'RW');
      const task = await rest.request(`https://api/api/w/${restSlug}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'RW', title: 'First task', status: 'todo' }),
      });
      assert(task.status === 201, await task.clone().text());
      const mcp = createMcpFetch({
        service: s,
        verify: async () => ctx,
        publicUrl: 'https://api',
        authorizationServer: 'https://auth',
        allowedOrigins: [],
      });
      const mcpSlug = `default-${crypto.randomUUID()}`;
      const rpc = await mcp(
        new Request(`https://api/w/${slug}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'create_workspace',
              arguments: { slug: mcpSlug, name: 'MCP Workspace', team_key: 'MW' },
            },
          }),
        }),
      );
      const text = await rpc.text(), line = text.split('\n').find((l) => l.startsWith('data: '));
      const result = JSON.parse(line ? line.slice(6) : text).result;
      assert(!result.isError, JSON.stringify(result));
      workspaces.push(result.structuredContent.result);
      assert((await s.listTeams(ctx, mcpSlug))[0].key === 'MW');
    } finally {
      for (const w of workspaces.reverse()) await cleanupWorkspace(admin, w.id);
      await admin.query('delete from roster.users where subject=$1', [ctx.identity.subject]);
      await runtime.pool.end();
      await admin.end();
    }
  },
});
