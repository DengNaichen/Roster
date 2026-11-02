import { Pool } from 'npm:pg@8.23.1';
import { AppError, type RequestContext } from '../../../contracts/mod.ts';
import type { Service } from '../application/mod.ts';
import { createDatabase } from '../platform/database/client.ts';
import { createUnitOfWork } from '../platform/database/session.ts';
import { createService } from '../service.ts';
import { prepareTestDatabase } from '../test_support.ts';
import { createHttpApp } from '../transport/http/app.ts';
import { createMcpFetch } from '../transport/mcp/server.ts';
import { workspace } from './access/index.ts';
import { createActivityService, hydrateIssueActivity } from './activity/index.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(run: () => Promise<unknown>, code: string) {
  try {
    await run();
  } catch (error) {
    assert(error instanceof AppError, `Expected AppError: ${error}`);
    assert(error.code === code, `${error.code}: ${error.message}`);
    return error;
  }
  throw new Error(`Expected ${code}`);
}
const connection = Deno.env.get('ROSTER_ACTIVITY_TEST_DATABASE_URL');
Deno.test({
  name:
    'Activity on real restricted Postgres: actor, pagination, delegation, DAG, visibility and REST/MCP',
  ignore: !connection,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    assert(connection);
    assert(
      new URL(connection).pathname === '/roster_activity_test',
      'Requires dedicated activity test database',
    );
    const setup = new Pool({ connectionString: connection });
    let runtime: ReturnType<typeof createDatabase> | undefined;
    try {
      await prepareTestDatabase(setup);
      await setup.query(
        `do $$ begin if not exists(select 1 from pg_roles where rolname='roster_activity_runtime') then create role roster_activity_runtime login nosuperuser nocreatedb nocreaterole nobypassrls;end if;end $$;grant roster_app to roster_activity_runtime`,
      );
      const runtimeUrl = new URL(connection);
      runtimeUrl.username = 'roster_activity_runtime';
      runtime = createDatabase(runtimeUrl.toString());
      const db = runtime.db;
      const core = createService(db);
      const activity = createActivityService(createUnitOfWork(db));
      const service = { ...core, ...activity } as Service;
      const ctx = (name: string): RequestContext => ({
        identity: { subject: crypto.randomUUID(), name, email: `${name}@example.test` },
      });
      const owner = ctx('owner'), member = ctx('member'), outsider = ctx('outsider');
      const slug = `act-${crypto.randomUUID()}`;
      const otherSlug = `act-${crypto.randomUUID()}`;
      await core.createWorkspace(owner, { slug, name: 'Activity' });
      await core.createWorkspace(outsider, { slug: otherSlug, name: 'Other' });
      await core.joinWorkspace(member, await core.resetInvite(owner, slug));
      await core.createTeam(owner, slug, { key: 'AL', name: 'Public' });
      await core.createTeam(owner, slug, { key: 'SEC', name: 'Secret', private: true });
      await core.createTeam(outsider, otherSlug, { key: 'AL', name: 'Other' });
      const a = await core.createIssue(owner, slug, {
        team: 'AL',
        title: 'A',
        assignee: owner.identity.subject,
      });
      const b = await core.createIssue(owner, slug, { team: 'AL', title: 'B' });
      const secret = await core.createIssue(owner, slug, { team: 'SEC', title: 'Secret' });
      const other = await core.createIssue(outsider, otherSlug, { team: 'AL', title: 'Other' });
      const comment = await activity.addComment(member, slug, {
        identifier: a.identifier,
        body: 'Human feedback',
      });
      assert(comment.author === 'member' && comment.actor?.subject === member.identity.subject);
      await rejects(() =>
        activity.addComment(
          member,
          slug,
          { identifier: a.identifier, body: 'Spoof', author: 'owner' } as never,
        ), 'invalid_input');
      await rejects(
        () => activity.addComment(member, slug, { identifier: secret.identifier, body: 'Hidden' }),
        'not_found',
      );
      await rejects(
        () =>
          activity.addComment(outsider, slug, {
            identifier: a.identifier,
            body: 'Other workspace',
          }),
        'forbidden',
      );
      const first = await activity.addWorkLog(owner, slug, {
        identifier: a.identifier,
        summary: 'Progress',
        body: 'Long body',
      });
      const decision = await activity.addWorkLog(member, slug, {
        identifier: a.identifier,
        kind: 'decision',
        summary: 'Use Postgres',
        body: 'Choice and rationale',
      });
      const page = await activity.listWorkLogs(owner, slug, { identifier: a.identifier, limit: 1 });
      assert(page.work_logs[0].id === decision.id && page.next_before === decision.id);
      assert(!('body' in page.work_logs[0]));
      const older = await activity.listWorkLogs(owner, slug, {
        identifier: a.identifier,
        before: page.next_before,
      });
      assert(older.work_logs[0].id === first.id && older.next_before === 0);
      assert(
        (await activity.getWorkLog(owner, slug, { identifier: a.identifier, id: decision.id }))
          .body === 'Choice and rationale',
      );
      await rejects(
        () => activity.getWorkLog(owner, slug, { identifier: b.identifier, id: decision.id }),
        'not_found',
      );
      await rejects(() =>
        activity.addWorkLog(owner, slug, {
          identifier: a.identifier,
          summary: 'multiline\nsummary',
          body: 'Body',
        }), 'invalid_input');
      const provenance = {
        agent: 'codex' as const,
        session_id: 'session-1',
        hostname: 'test-host',
      };
      const delegated = await activity.delegateIssue(member, slug, {
        identifier: a.identifier,
        client_context: provenance,
      });
      const repeat = await activity.delegateIssue(owner, slug, {
        identifier: a.identifier,
        client_context: provenance,
      });
      assert(delegated.id === repeat.id && repeat.actor?.subject === member.identity.subject);
      assert((await core.getIssue(owner, slug, a.identifier)).status === 'in_progress');
      await rejects(() =>
        activity.delegateIssue(owner, slug, {
          identifier: b.identifier,
          client_context: provenance,
        }), 'invalid_input');
      await core.updateIssue(owner, slug, a.identifier, { status: 'done' });
      await activity.delegateIssue(owner, slug, {
        identifier: a.identifier,
        client_context: provenance,
      });
      assert((await core.getIssue(owner, slug, a.identifier)).status === 'in_progress');
      await core.updateIssue(owner, slug, a.identifier, { assignee: null });
      await rejects(() =>
        activity.delegateIssue(owner, slug, {
          identifier: a.identifier,
          client_context: provenance,
        }), 'invalid_input');
      await activity.addLink(owner, slug, {
        identifier: a.identifier,
        title: 'Design',
        url: 'https://example.test/design',
      });
      for (
        const url of [
          'javascript:alert(1)',
          'https://user:password@example.test',
          'https://example.test/white space',
        ]
      ) {
        await rejects(
          () => activity.addLink(owner, slug, { identifier: a.identifier, title: 'Bad', url }),
          'invalid_input',
        );
      }
      await activity.addRelation(owner, slug, {
        identifier: a.identifier,
        kind: 'blocks',
        other: secret.identifier,
      });
      await activity.addRelation(owner, slug, {
        identifier: secret.identifier,
        kind: 'blocks',
        other: b.identifier,
      });
      const cycle = await rejects(() =>
        activity.addRelation(member, slug, {
          identifier: b.identifier,
          kind: 'blocks',
          other: a.identifier,
        }), 'invalid_input');
      assert(!cycle.message.includes(secret.identifier));
      await rejects(() =>
        activity.addRelation(member, slug, {
          identifier: a.identifier,
          kind: 'related',
          other: secret.identifier,
        }), 'not_found');
      await rejects(() =>
        activity.addRelation(owner, slug, {
          identifier: a.identifier,
          kind: 'related',
          other: a.identifier,
        }), 'invalid_input');
      await activity.addRelation(owner, slug, {
        identifier: a.identifier,
        kind: 'related',
        other: b.identifier,
      });
      await activity.addRelation(owner, slug, {
        identifier: b.identifier,
        kind: 'related',
        other: a.identifier,
      });
      const c = await core.createIssue(owner, slug, { team: 'AL', title: 'C' }),
        d = await core.createIssue(owner, slug, { team: 'AL', title: 'D' });
      const results = await Promise.allSettled([
        activity.addRelation(owner, slug, {
          identifier: c.identifier,
          kind: 'blocks',
          other: d.identifier,
        }),
        activity.addRelation(owner, slug, {
          identifier: d.identifier,
          kind: 'blocks',
          other: c.identifier,
        }),
      ]);
      assert(
        results.filter((r) => r.status === 'fulfilled').length === 1,
        'Concurrent DAG writers must reject one edge',
      );
      const detail = await hydrateIssueActivity(
        createUnitOfWork(db),
        member,
        await workspace(createUnitOfWork(db), member, slug),
        await core.getIssue(member, slug, a.identifier),
      );
      assert(
        detail.comments.length === 1 && detail.links.length === 1 && detail.work_log_count === 2 &&
          detail.decisions[0].id === decision.id && detail.delegations.length === 1,
      );
      assert(
        detail.blocks.length === 0 && detail.related.length === 1,
        'Private relation targets must be hidden',
      );
      const owned = await hydrateIssueActivity(
        createUnitOfWork(db),
        owner,
        await workspace(createUnitOfWork(db), owner, slug),
        await core.getIssue(owner, slug, a.identifier),
      );
      assert(owned.blocks[0].identifier === secret.identifier);
      const app = createHttpApp({
        service,
        verify: async () => member,
        allowedOrigins: [],
      });
      const post = await app.request(`https://app/api/w/${slug}/issues/${a.identifier}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'REST comment' }),
      });
      assert(post.status === 201, await post.text());
      const mcp = createMcpFetch({
        service,
        verify: async () => member,
        allowedOrigins: [],
        publicUrl: 'https://app',
        authorizationServer: 'https://auth',
      });
      const rpc = await mcp(
        new Request(`https://app/w/${slug}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2025-11-25',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'add_work_log',
              arguments: {
                identifier: a.identifier,
                kind: 'decision',
                summary: 'MCP decision',
                body: 'Test evidence',
              },
            },
          }),
        }),
      );
      const response = await rpc.text();
      assert(rpc.status === 200 && !response.includes('isError":true'), response);
      // A real transport chain crosses REST -> shared catalog -> MCP -> issue hydration.
      const rest = async (path: string, method = 'GET', body?: unknown) => {
        const response = await app.request(`https://app/api/w/${slug}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await response.json();
        assert(response.ok, JSON.stringify(data));
        return data;
      };
      const call = async (name: string, input: unknown) => {
        const response = await mcp(
          new Request(`https://app/w/${slug}/mcp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/event-stream',
              'MCP-Protocol-Version': '2025-11-25',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name, arguments: input },
            }),
          }),
        );
        const text = await response.text();
        const line = text.split('\n').find((v) => v.startsWith('data: '));
        const document = JSON.parse(line ? line.slice(6) : text);
        assert(response.ok && !document.result?.isError, text);
        return document.result.structuredContent.result;
      };
      const project = await rest('/projects', 'POST', { name: 'Transport project', teams: ['AL'] });
      const renamed = await call('update_project', {
        id: project.id,
        new_name: 'Transport renamed',
      });
      assert(renamed.name === 'Transport renamed');
      const label = await call('create_label', { name: 'Transport label', color: '#123456' });
      const linked = await rest('/issues', 'POST', {
        team: 'AL',
        title: 'Transport linked issue',
        project_id: project.id,
      });
      await rest('/issue-labels', 'POST', { identifiers: [linked.identifier], add: [label.id] });
      const hydrated = await call('get_issue', { identifier: linked.identifier });
      assert(
        hydrated.project_id === project.id && hydrated.project === 'Transport renamed' &&
          hydrated.labels.some((l: { id: number }) => l.id === label.id),
        'REST/MCP must hydrate real project and label records',
      );
      assert(
        hydrated.audit.length > 0 &&
          hydrated.audit.every((event: { id: string }) => /^[1-9][0-9]*$/.test(event.id)),
        'MCP audit ids must preserve bigint decimal strings',
      );
      const logs = await rest(`/issues/${a.identifier}/work-logs?kind=decision`);
      assert(
        logs.work_logs.some((log: { summary: string }) => log.summary === 'MCP decision'),
        'MCP work logs must be readable through REST',
      );
      const workspaceId = (await workspace(createUnitOfWork(db), owner, slug)).id;
      await runtime.pool.query(
        'insert into roster.comments(workspace_id,issue_id,body,actor_subject,author) values($1,$2,$3,null,$4)',
        [workspaceId, a.id, 'Imported comment', 'Historical Author'],
      );
      const historical = await core.getIssue(owner, slug, a.identifier);
      assert(
        historical.comments.some((c) => c.author === 'Historical Author' && c.actor === null),
        'Imported unknown authors must remain unknown actors',
      );
      const e = await core.createIssue(owner, slug, { team: 'AL', title: 'E' }),
        f = await core.createIssue(owner, slug, { team: 'AL', title: 'F' });
      const direct = await Promise.allSettled([
        runtime.pool.query('insert into roster.relations values($1,$2,$3,$4)', [
          workspaceId,
          e.id,
          'blocks',
          f.id,
        ]),
        runtime.pool.query('insert into roster.relations values($1,$2,$3,$4)', [
          workspaceId,
          f.id,
          'blocks',
          e.id,
        ]),
      ]);
      assert(
        direct.filter((r) => r.status === 'fulfilled').length === 1,
        'Database trigger must reject a concurrent direct cycle',
      );
      // Database foreign keys independently reject cross-workspace relation references.
      let denied = false;
      try {
        await runtime.pool.query('insert into roster.relations values($1,$2,$3,$4)', [
          (await workspace(createUnitOfWork(db), owner, slug)).id,
          a.id,
          'related',
          other.id,
        ]);
      } catch {
        denied = true;
      }
      assert(denied);
    } finally {
      await runtime?.pool.end();
      await setup.end();
    }
  },
});
