import { Pool } from 'npm:pg@8.23.1';
import { AppError, type RequestContext } from '../../../contracts/mod.ts';
import { createDatabase } from '../platform/database/client.ts';
import { createService } from '../service.ts';
import { cleanupWorkspace, prepareTestDatabase } from '../test_support.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof AppError && error.code === code, String(error));
    return;
  }
  throw new Error('Expected ' + code);
}
const url = Deno.env.get('ROSTER_TEST_DATABASE_URL');
Deno.test({
  name:
    'Spec–issue links: atomic, idempotent, many-to-many, workspace constraints and visibility on both ends',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assert(url && new URL(url).pathname.endsWith('_test'));
    const admin = new Pool({ connectionString: url });
    let runtime: ReturnType<typeof createDatabase> | undefined;
    const workspaces: string[] = [];
    const actor = (name: string): RequestContext => ({
      identity: { subject: crypto.randomUUID(), name, email: name + '@example.test' },
    });
    const owner = actor('owner'), member = actor('member'), outsider = actor('outsider');
    try {
      await prepareTestDatabase(admin);
      const runtimeUrl = new URL(url);
      runtimeUrl.username = 'roster_test_runtime';
      runtime = createDatabase(runtimeUrl.toString());
      const s = createService(runtime.db);
      const w = await s.createWorkspace(owner, {
        slug: 'links-' + crypto.randomUUID(),
        name: 'Links',
      });
      workspaces.push(w.id);
      await s.joinWorkspace(member, await s.resetInvite(owner, w.slug));
      await s.createTeam(owner, w.slug, { key: 'AL', name: 'Public' });
      await s.createTeam(member, w.slug, { key: 'SEC', name: 'Private', private: true });
      const spec = await s.createSpec(owner, w.slug, {
        team: 'AL',
        content: { title: 'Public spec', status: 'approved' },
      });
      const second = await s.createSpec(owner, w.slug, {
        team: 'AL',
        content: { title: 'Second spec', status: 'draft' },
      });
      const secret = await s.createSpec(member, w.slug, {
        team: 'SEC',
        content: { title: 'Secret spec', status: 'draft' },
      });
      const issue = await s.createIssue(owner, w.slug, {
        team: 'AL',
        title: 'Public issue',
        status: 'todo',
      });
      const privateIssue = await s.createIssue(member, w.slug, {
        team: 'SEC',
        title: 'Private issue',
      });
      const change = { identifier: spec.identifier, issues: [issue.identifier] };
      await Promise.all(Array.from({ length: 5 }, () => s.linkSpecIssues(owner, w.slug, change)));
      assert((await s.listIssues(owner, w.slug, { spec: spec.identifier })).items.length === 1);
      assert((await s.listIssueSpecs(owner, w.slug, { issue: issue.identifier })).length === 1);
      const counts = await admin.query(
        'select count(*) as count from roster.spec_issues where workspace_id=$1',
        [w.id],
      );
      assert(Number(counts.rows[0].count) === 1);
      await s.linkSpecIssues(owner, w.slug, {
        identifier: second.identifier,
        issues: [issue.identifier],
      });
      await s.linkSpecIssues(member, w.slug, {
        identifier: secret.identifier,
        issues: [issue.identifier],
      });
      await s.linkSpecIssues(member, w.slug, {
        identifier: spec.identifier,
        issues: [privateIssue.identifier],
      });
      assert(
        (await s.listIssues(owner, w.slug, { spec: spec.identifier })).items.length === 1,
        'Private issue leaked',
      );
      assert((await s.listIssues(member, w.slug, { spec: spec.identifier })).items.length === 2);
      assert(
        (await s.listIssueSpecs(owner, w.slug, { issue: issue.identifier })).length === 2,
        'Private spec leaked',
      );
      assert((await s.listIssueSpecs(member, w.slug, { issue: issue.identifier })).length === 3);
      await rejects(
        () =>
          s.linkSpecIssues(owner, w.slug, {
            identifier: secret.identifier,
            issues: [issue.identifier],
          }),
        'not_found',
      );
      await rejects(() => s.listIssues(owner, w.slug, { spec: secret.identifier }), 'not_found');
      await rejects(
        () =>
          s.unlinkSpecIssues(owner, w.slug, {
            identifier: spec.identifier,
            issues: [privateIssue.identifier],
          }),
        'not_found',
      );
      await rejects(
        () => s.listIssueSpecs(owner, w.slug, { issue: privateIssue.identifier }),
        'not_found',
      );
      await rejects(() => s.linkSpecIssues(outsider, w.slug, change), 'forbidden');
      const fresh = await s.createIssue(owner, w.slug, { team: 'AL', title: 'Rollback fixture' });
      await rejects(
        () =>
          s.linkSpecIssues(owner, w.slug, {
            identifier: spec.identifier,
            issues: [fresh.identifier, 'AL-999999'],
          }),
        'not_found',
      );
      assert(
        (await s.listIssueSpecs(owner, w.slug, { issue: fresh.identifier })).length === 0,
        'Batch partially committed',
      );
      await rejects(
        () => s.linkSpecIssues(owner, w.slug, { identifier: spec.identifier, issues: [] }),
        'invalid_input',
      );
      const other = await s.createWorkspace(outsider, {
        slug: 'other-' + crypto.randomUUID(),
        name: 'Other',
      });
      workspaces.push(other.id);
      await s.createTeam(outsider, other.slug, { key: 'BB', name: 'Other' });
      const otherIssue = await s.createIssue(outsider, other.slug, {
        team: 'BB',
        title: 'Other workspace',
      });
      await rejects(
        () =>
          s.linkSpecIssues(owner, w.slug, {
            identifier: spec.identifier,
            issues: [otherIssue.identifier],
          }),
        'not_found',
      );
      const specId =
        (await admin.query('select id from roster.specs where workspace_id=$1 and number=$2', [
          w.id,
          Number(spec.identifier.slice(5)),
        ])).rows[0].id;
      try {
        await admin.query(
          'insert into roster.spec_issues(workspace_id,spec_id,issue_id,created_by) values($1,$2,$3,$4)',
          [w.id, specId, otherIssue.id, owner.identity.subject],
        );
        throw new Error('Cross-workspace FK accepted');
      } catch (error) {
        assert((error as { code?: string }).code === '23503', String(error));
      }
      await s.unlinkSpecIssues(owner, w.slug, change);
      await s.unlinkSpecIssues(owner, w.slug, change);
      assert(
        (await s.listIssueSpecs(owner, w.slug, { issue: issue.identifier })).length === 1,
        'Unlink changed another spec',
      );
      const unchangedIssue = await s.getIssue(owner, w.slug, issue.identifier);
      const unchangedSpec = await s.getSpec(owner, w.slug, spec.identifier);
      assert(
        unchangedIssue.status === issue.status && unchangedIssue.updated_at === issue.updated_at,
      );
      assert(
        unchangedSpec.revision === spec.revision && unchangedSpec.updated_at === spec.updated_at,
      );
      // A linked issue becoming private is filtered using current permissions.
      await s.createTeam(owner, w.slug, { key: 'ALT', name: 'Later private' });
      const later = await s.createIssue(owner, w.slug, {
        team: 'ALT',
        title: 'Later private issue',
      });
      await s.linkSpecIssues(member, w.slug, {
        identifier: second.identifier,
        issues: [later.identifier],
      });
      await s.updateTeam(owner, w.slug, 'ALT', { private: true });
      assert(
        !(await s.listIssues(member, w.slug, { spec: second.identifier })).items.some((i) =>
          i.identifier === later.identifier
        ),
      );
      await rejects(
        () =>
          s.unlinkSpecIssues(member, w.slug, {
            identifier: second.identifier,
            issues: [later.identifier],
          }),
        'not_found',
      );
      // Explicit all-results reads must not lose links beyond the normal 50-row page.
      const identifiers = [];
      for (let i = 0; i < 51; i++) {
        identifiers.push(
          (await s.createIssue(owner, w.slug, { team: 'AL', title: 'Linked fixture ' + i }))
            .identifier,
        );
      }
      await s.linkSpecIssues(owner, w.slug, { identifier: spec.identifier, issues: identifiers });
      const all = await s.listIssues(owner, w.slug, { spec: spec.identifier, limit: -1 });
      assert(all.items.length === 51 && all.next_cursor === null);
      const first = await s.listIssues(owner, w.slug, { spec: spec.identifier, limit: 10 });
      assert(first.items.length === 10 && first.next_cursor);
      const next = await s.listIssues(owner, w.slug, {
        spec: spec.identifier,
        limit: 10,
        cursor: first.next_cursor,
      });
      assert(
        next.items.length === 10 && !next.items.some((i) => first.items.some((j) => j.id === i.id)),
      );
      await s.updateMember(owner, w.slug, {
        subject: member.identity.subject,
        role: 'member',
        status: 'suspended',
      });
      await rejects(
        () => s.listIssueSpecs(member, w.slug, { issue: issue.identifier }),
        'forbidden',
      );
      await rejects(
        () =>
          s.unlinkSpecIssues(member, w.slug, {
            identifier: secret.identifier,
            issues: [issue.identifier],
          }),
        'forbidden',
      );
    } finally {
      for (const id of workspaces.reverse()) await cleanupWorkspace(admin, id);
      if (runtime) await runtime.pool.end();
      await admin.end();
    }
  },
});
