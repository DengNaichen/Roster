import { Pool } from 'npm:pg@8.23.1';
import type { IssueDetail, RequestContext } from '../../../contracts/mod.ts';
import { createDatabase } from '../platform/database/client.ts';
import { createService } from '../service.ts';
import { cleanupWorkspace, prepareTestDatabase } from '../test_support.ts';
import { createMcpFetch } from '../transport/mcp/server.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const url = Deno.env.get('ROSTER_TEST_DATABASE_URL');
Deno.test({
  name:
    'save_issue composes atomic writes, resolves labels and preserves access and dependency invariants',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assert(url && new URL(url).pathname.endsWith('_test'));
    const admin = new Pool({ connectionString: url });
    let runtime: ReturnType<typeof createDatabase> | undefined;
    const workspaces: string[] = [];
    const owner: RequestContext = {
      identity: { subject: crypto.randomUUID(), name: 'Owner', email: 'owner@save.test' },
    };
    const member: RequestContext = {
      identity: { subject: crypto.randomUUID(), name: 'Member', email: 'member@save.test' },
    };
    try {
      await prepareTestDatabase(admin);
      const runtimeUrl = new URL(url);
      runtimeUrl.username = 'roster_test_runtime';
      runtime = createDatabase(runtimeUrl.toString());
      const service = createService(runtime.db);
      const w = await service.createWorkspace(owner, {
        slug: 'save-' + crypto.randomUUID(),
        name: 'Save test',
        team_key: 'SAVE',
      });
      workspaces.push(w.id);
      await service.joinWorkspace(member, await service.resetInvite(owner, w.slug));
      await service.createTeam(owner, w.slug, { key: 'SEC', name: 'Secret', private: true });
      const secret = await service.createIssue(owner, w.slug, { team: 'SEC', title: 'Hidden' });
      const otherWorkspace = await service.createWorkspace(owner, {
        slug: 'save-' + crypto.randomUUID(),
        name: 'Other',
        team_key: 'OTHER',
      });
      workspaces.push(otherWorkspace.id);
      const foreign = await service.createIssue(owner, otherWorkspace.slug, {
        team: 'OTHER',
        title: 'Foreign',
      });
      const blocker = await service.createIssue(owner, w.slug, { team: 'SAVE', title: 'Blocker' });
      const related = await service.createIssue(owner, w.slug, { team: 'SAVE', title: 'Related' });
      const group = await service.saveLabelGroup(owner, w.slug, { name: 'Kind' });
      const bug = await service.createLabel(owner, w.slug, {
        name: 'Bug',
        color: '#ff0000',
        group_id: group.id,
      });
      const feature = await service.createLabel(owner, w.slug, {
        name: 'Feature',
        color: '#00ff00',
        group_id: group.id,
      });
      const auth = await service.createLabel(owner, w.slug, { name: 'Auth', color: '#0000ff' });
      const mcp = createMcpFetch({
        service,
        verify: async (r) => r.headers.get('x-actor') === 'owner' ? owner : member,
        allowedOrigins: [],
        publicUrl: 'https://app',
        authorizationServer: 'https://auth',
      });
      const call = async (args: unknown, as = 'member', name = 'save_issue') => {
        const response = await mcp(
          new Request(`https://app/w/${w.slug}/mcp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
              'x-actor': as,
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
        const line = text.split('\n').find((line) => line.startsWith('data: '));
        return JSON.parse(line ? line.slice(6) : text);
      };
      const ok = async (args: unknown) => {
        const response = await call(args);
        assert(!response.error && !response.result.isError, JSON.stringify(response));
        return response.result.structuredContent.result as IssueDetail;
      };
      const reject = async (args: unknown, message: string) => {
        const response = await call(args);
        assert(response.error || response.result?.isError, JSON.stringify(response));
        assert(JSON.stringify(response).includes(message), JSON.stringify(response));
      };
      const link = { title: 'PR', url: 'https://github.com/example/repo/pull/1' };
      const issue = await ok({
        team: 'Save test',
        title: 'Combined',
        assignee: 'me',
        add_labels: ['bug', auth.id],
        blocked_by: [blocker.identifier],
        related_to: [related.identifier],
        links: [link, link],
      });
      assert(issue.assignee?.subject === member.identity.subject);
      assert(issue.labels.length === 2 && issue.links.length === 1);
      assert(
        issue.blocked_by[0].identifier === blocker.identifier &&
          issue.related[0].identifier === related.identifier,
      );
      assert(
        !Object.hasOwn(issue, 'audit'),
        'save_issue omits bulky audit snapshots',
      );
      const update = {
        identifier: issue.identifier,
        title: 'Changed',
        assignee: null,
        add_labels: ['Feature'],
        remove_labels: ['Auth'],
        remove_blocked_by: [blocker.identifier],
        blocks: [blocker.identifier],
        links: [link],
      };
      await ok(update);
      const saved = await ok(update);
      assert(
        saved.assignee === null && saved.labels.length === 1 && saved.labels[0].id === feature.id,
      );
      assert(
        saved.blocks.length === 1 && saved.blocked_by.length === 0 && saved.links.length === 1,
      );
      assert(saved.related.length === 1, 'Omitted relations stay unchanged');
      await ok({
        identifier: issue.identifier,
        remove_blocks: [blocker.identifier],
        remove_related_to: [related.identifier],
        remove_labels: [feature.id],
      });
      const plain = await service.getIssue(owner, w.slug, issue.identifier);
      assert(plain.blocks.length === 0 && plain.related.length === 0 && plain.labels.length === 0);
      await reject({ title: 'Missing team' }, 'team');
      await reject({ team: 'SAVE' }, 'title');
      await reject({ identifier: issue.identifier, team: 'SAVE' }, 'Team cannot be changed');
      await reject({ identifier: issue.identifier, add_labels: ['missing'] }, 'No label matches');
      await reject({
        identifier: issue.identifier,
        blocks: [related.identifier],
        remove_blocks: [related.identifier],
      }, 'Cannot add and remove');

      // A late relation failure must roll back the earlier title, label and edge writes.
      await reject({
        identifier: issue.identifier,
        title: 'Must roll back',
        add_labels: [bug.id],
        blocks: [blocker.identifier, secret.identifier],
        links: [link],
      }, 'not_found');
      const unchanged = await service.getIssue(owner, w.slug, issue.identifier);
      assert(
        unchanged.title === 'Changed' && unchanged.labels.length === 0 &&
          unchanged.blocks.length === 0,
      );
      await reject({
        identifier: issue.identifier,
        title: 'Must roll back',
        add_labels: [bug.id],
        blocks: [foreign.identifier],
      }, 'not_found');
      await reject(
        { team: 'SAVE', title: 'Rollback create', add_labels: [bug.id, feature.id] },
        'multiple labels',
      );
      await reject({
        identifier: issue.identifier,
        title: 'Must roll back',
        add_labels: ['Bug'],
        remove_labels: [bug.id],
      }, 'same label');
      await ok({ identifier: issue.identifier, blocks: [blocker.identifier] });
      await reject({
        identifier: blocker.identifier,
        title: 'Cycle rollback',
        blocks: [issue.identifier],
      }, 'Dependency cycle');
      await reject({ identifier: issue.identifier, blocks: [issue.identifier] }, 'Self relations');
      assert((await service.getIssue(owner, w.slug, blocker.identifier)).title === 'Blocker');
      assert((await service.getIssue(owner, w.slug, issue.identifier)).labels.length === 0);
      assert(
        (await admin.query(
          "select count(*)::int n from roster.issues where workspace_id=$1 and title in ('Rollback create','Must roll back','Missing team')",
          [w.id],
        )).rows[0].n === 0,
      );
      for (
        const name of [
          'create_issue',
          'update_issue',
          'change_issue_labels',
          'add_relation',
          'remove_relation',
          'add_link',
        ]
      ) {
        const retired = await call({}, 'owner', name);
        assert(retired.error || retired.result?.isError, `Retired tool ${name} still callable`);
      }
    } finally {
      if (runtime) await runtime.pool.end();
      for (const id of workspaces.reverse()) await cleanupWorkspace(admin, id);
      await admin.end();
    }
  },
});
