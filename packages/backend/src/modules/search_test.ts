import { Pool } from 'npm:pg@8.23.1';
import { AppError, type RequestContext } from '../../../contracts/mod.ts';
import { createDatabase } from '../platform/database/client.ts';
import { createService } from '../service.ts';
import { cleanupWorkspace, prepareTestDatabase } from '../test_support.ts';
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
    'Workspace search: cross-entity literal matches, precise pagination, current specs and private visibility',
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
    const owner: RequestContext = {
      identity: { subject: crypto.randomUUID(), name: 'Owner', email: 'owner@example.test' },
    };
    const member: RequestContext = {
      identity: { subject: crypto.randomUUID(), name: 'Member', email: 'member@example.test' },
    };
    const workspaces = [];
    try {
      const w = await s.createWorkspace(owner, {
        slug: `search-${crypto.randomUUID()}`,
        name: 'Search',
      });
      workspaces.push(w);
      const other = await s.createWorkspace(owner, {
        slug: `search-${crypto.randomUUID()}`,
        name: 'Other',
      });
      workspaces.push(other);
      await s.joinWorkspace(member, await s.resetInvite(owner, w.slug));
      for (const slug of [w.slug, other.slug]) {
        await s.createTeam(owner, slug, { key: 'PU', name: 'Public' });
      }
      await s.createTeam(owner, w.slug, { key: 'PR', name: 'Private', private: true });
      const issue = await s.createIssue(owner, w.slug, {
        team: 'PU',
        title: 'Needle',
        document: { lead: '100% literal match 中文', sections: [], criteria: [] },
      });
      await s.createIssue(owner, w.slug, { team: 'PU', title: 'Needle first' });
      await s.createIssue(owner, w.slug, { team: 'PR', title: 'Needle hidden issue' });
      await s.createIssue(owner, other.slug, { team: 'PU', title: 'Needle other workspace' });
      const spec = await s.createSpec(owner, w.slug, {
        team: 'PU',
        content: {
          title: 'Needle spec',
          status: 'draft',
          requirements: [{ id: 'FR-1', text: 'Current needle content' }],
        },
      });
      await s.createSpec(owner, w.slug, {
        team: 'PR',
        content: { title: 'Needle private spec', status: 'draft' },
      });
      const project = await s.createProject(owner, w.slug, {
        name: 'Needle project',
        teams: ['PU'],
        description: 'public project description',
      });
      const privateProject = await s.createProject(owner, w.slug, {
        name: 'Needle private project',
        teams: ['PR'],
      });
      const archived = await s.createProject(owner, w.slug, {
        name: 'Needle archived project',
        teams: ['PU'],
      });
      await s.updateProject(owner, w.slug, { id: archived.id, archived: true });
      const page = await s.search(member, w.slug, { query: 'needle', limit: 50 });
      assert(page.results.length === 4, JSON.stringify(page));
      assert(
        page.results[0].reference === `issue:${issue.identifier}`,
        'Exact title precedes prefixes',
      );
      assert(
        new Set(page.results.map((r) => r.type)).size === 3,
      );
      assert(
        page.results.some((r) => r.reference === `project:${project.id}` && r.updated_at === null),
      );
      assert(
        !JSON.stringify(page).includes('hidden') && !JSON.stringify(page).includes('private') &&
          !JSON.stringify(page).includes('other workspace'),
      );
      assert(!Object.hasOwn(page, 'total') && !Object.hasOwn(page, 'hidden_count'));
      assert((await s.search(member, w.slug, { query: '100%' })).results.length === 1);
      assert((await s.search(member, w.slug, { query: '中文' })).results.length === 1);
      assert(
        (await s.search(member, w.slug, { query: '_', limit: 50 })).results.length === 0,
        'Underscore is literal, not a wildcard',
      );
      assert(
        (await s.search(member, w.slug, { query: issue.identifier })).results[0].reference ===
          `issue:${issue.identifier}`,
      );
      assert(
        (await s.search(member, w.slug, { query: 'needle', type: 'spec' })).results.length === 1,
      );
      assert(
        (await s.search(owner, w.slug, { query: 'needle', type: 'project' })).results.length === 2,
      );
      // Force a sub-millisecond tie so cursor precision and stable type/id ordering are exercised.
      await admin.query(
        "update roster.issues set updated_at='2026-11-17T00:00:00.123456Z' where workspace_id=$1",
        [w.id],
      );
      const full = await s.search(member, w.slug, { query: 'needle', limit: 50 });
      let cursor: string | undefined;
      const refs: string[] = [];
      do {
        const next = await s.search(member, w.slug, { query: 'needle', limit: 1, cursor });
        refs.push(...next.results.map((r) => r.reference));
        cursor = next.next_cursor ?? undefined;
      } while (cursor);
      assert(
        JSON.stringify(refs) === JSON.stringify(full.results.map((r) => r.reference)),
        'Pages must match the unpaged order without gaps or duplicates',
      );
      const first = await s.search(member, w.slug, { query: 'needle', limit: 1 });
      assert(first.next_cursor);
      await rejects(() =>
        s.search(member, w.slug, { query: 'changed', cursor: first.next_cursor! })
      );
      await rejects(() => s.search(owner, w.slug, { query: 'needle', cursor: first.next_cursor! }));
      await rejects(() =>
        s.search(member, w.slug, { query: 'needle', type: 'issue', cursor: first.next_cursor! })
      );
      await rejects(() =>
        s.search(owner, other.slug, { query: 'needle', cursor: first.next_cursor! })
      );
      await rejects(() => s.search(member, w.slug, { query: 'needle', cursor: 'not base64' }));
      await rejects(() => s.search(member, w.slug, { query: '  ' }));
      await rejects(() => s.search(member, w.slug, { query: 'needle', limit: 0 }));
      await s.updateSpec(owner, w.slug, {
        identifier: spec.identifier,
        base_revision: 1,
        content: {
          title: 'Replaced spec',
          status: 'draft',
          requirements: [{ id: 'FR-1', text: 'new content' }],
        },
      });
      assert(
        (await s.search(member, w.slug, { query: 'needle', type: 'spec' })).results.length === 0,
        'Historical revisions are not searched',
      );
      const mcp = createMcpFetch({
        service: s,
        verify: async () => member,
        publicUrl: 'https://api',
        authorizationServer: 'https://auth',
        allowedOrigins: [],
      });
      const rpc = async (name: string, args: unknown) => {
        const response = await mcp(
          new Request(`https://api/w/${w.slug}/mcp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name, arguments: args },
            }),
          }),
        );
        const text = await response.text();
        const line = text.split('\n').find((l) => l.startsWith('data: '));
        return JSON.parse(line ? line.slice(6) : text);
      };
      const found = await rpc('search', { query: '100%' });
      assert(
        found.result.structuredContent.result.results[0].reference === `issue:${issue.identifier}`,
      );
      const fetched = await rpc('fetch', { reference: `issue:${issue.identifier}` });
      assert(fetched.result.structuredContent.result.identifier === issue.identifier);
      const hidden = await rpc('fetch', { reference: `project:${privateProject.id}` });
      assert(hidden.result.isError, 'Fetch rechecks visibility');
      await s.updateMember(owner, w.slug, {
        subject: member.identity.subject,
        role: 'member',
        status: 'suspended',
      });
      await rejects(() => s.search(member, w.slug, { query: 'needle' }));
    } finally {
      for (const w of workspaces.reverse()) await cleanupWorkspace(admin, w.id);
      for (const person of [owner, member]) {
        await admin.query('delete from roster.users where subject=$1', [person.identity.subject]);
      }
      await runtime.pool.end();
      await admin.end();
    }
  },
});
