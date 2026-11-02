import { Pool } from 'npm:pg@8.23.1';
import type { SpecContent } from '../../../contracts/spec.ts';
import { createDatabase } from '../platform/database/client.ts';
import { createService } from '../service.ts';
import { cleanupWorkspace, prepareTestDatabase } from '../test_support.ts';
import { importLinear } from './import-linear.ts';
import { importSQLite, type SQLiteSnapshot } from './import-sqlite.ts';
const assert = (v: unknown, m = 'Assertion failed') => {
  if (!v) throw new Error(m);
};
const url = Deno.env.get('ROSTER_IMPORT_TEST_DATABASE_URL');
Deno.test({
  name:
    'SQLite import maps identities/references and rolls back invalid snapshots; Linear import remains atomic',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const setup = new Pool({ connectionString: url });
    await prepareTestDatabase(setup);
    const subject = crypto.randomUUID();
    const at = '2026-01-01T00:00:00.000Z';
    const originalSpec: SpecContent = {
      title: 'Imported SPEC',
      status: 'draft',
      branch: '001-import',
      stories: [{
        id: 'US-1',
        title: 'Read history',
        priority: 'P1',
        description: 'Keep original snapshots',
        why: 'Audit',
        independent_test: 'Read revision 1',
        scenarios: [],
      }],
      edge_cases: ['旧历史保持 Unicode'],
      requirements: [{ id: 'FR-001', text: 'Preserve revisions' }],
      entities: [],
      success_criteria: [{ id: 'SC-001', text: 'History is exact' }],
      clarifications: [],
    };
    const removedSpec: SpecContent = {
      ...originalSpec,
      stories: [],
      requirements: [],
      success_criteria: [],
    };
    const currentSpec: SpecContent = {
      ...originalSpec,
      status: 'approved',
      stories: originalSpec.stories.map((story) => ({ ...story, id: 'US-2' })),
      requirements: [{ id: 'FR-002', text: 'Use a fresh requirement ID' }],
      success_criteria: [{ id: 'SC-002', text: 'Never recycle a retired ID' }],
    };
    const snapshot: SQLiteSnapshot = {
      format: 'inftask-sqlite-v1',
      tables: {
        users: [{ subject: 'old-uc', name: 'Imported user', email: 'import@test.local' }],
        workspaces: [{ id: 1, slug: 'import-fixture', name: 'Imported' }],
        workspace_members: [{
          workspace_id: 1,
          subject: 'old-uc',
          role: 'admin',
          status: 'active',
        }],
        workspace_invites: [{ workspace_id: 1, digest: 'a'.repeat(64) }],
        teams: [{
          id: 1,
          workspace_id: 1,
          key: 'AA',
          name: 'Imported team',
          next_number: 20,
          emoji: '',
          private: 0,
        }],
        team_members: [{ team_id: 1, subject: 'old-uc', role: 'owner' }],
        projects: [{
          id: 1,
          workspace_id: 1,
          name: 'Imported project',
          description: 'Preserved project',
          archived: 0,
          emoji: '',
          start_date: '2026-01-01',
          target_date: '2026-02-01',
        }],
        project_teams: [{ project_id: 1, team_id: 1 }],
        initiatives: [{
          id: 1,
          workspace_id: 1,
          name: 'Imported initiative',
          description: '',
          archived: 0,
        }],
        initiative_projects: [{ initiative_id: 1, project_id: 1 }],
        label_groups: [{ id: 1, workspace_id: 1, name: 'Area', name_key: 'area' }],
        labels: [{
          id: 1,
          workspace_id: 1,
          name: 'API',
          name_key: 'api',
          color: '#112233',
          description: '',
          group_id: 1,
          archived: 0,
        }],
        cycles: [{
          id: 1,
          team_id: 1,
          number: 1,
          name: 'Past cycle',
          description: '',
          timezone: 'UTC',
          starts_at: '2025-01-01T00:00:00Z',
          ends_at: '2025-01-08T00:00:00Z',
          completed_at: '2025-01-08T00:00:00Z',
          total: 1,
          done: 0,
          canceled: 0,
          rolled_over: 1,
        }],
        team_cycle_settings: [{
          team_id: 1,
          enabled: 0,
          timezone: 'UTC',
          start_date: '2025-01-01',
          duration_weeks: 1,
          upcoming_count: 2,
        }],
        issues: [{
          id: 1,
          workspace_id: 1,
          team_id: 1,
          number: 1,
          identifier: 'AA-1',
          title: 'Imported parent',
          description: 'Markdown **kept**',
          status: 'todo',
          type: 'feature',
          priority: 2,
          project_id: 1,
          cycle_id: null,
          parent_id: null,
          assignee_subject: 'old-uc',
          created_at: at,
          updated_at: at,
        }, {
          id: 2,
          workspace_id: 1,
          team_id: 1,
          number: 2,
          identifier: 'AA-2',
          title: 'Imported child',
          description: '',
          status: 'done',
          type: null,
          priority: 0,
          project_id: 1,
          cycle_id: 1,
          parent_id: 1,
          assignee_subject: null,
          created_at: at,
          updated_at: at,
        }],
        issue_labels: [{ issue_id: 1, label_id: 1 }],
        comments: [{
          id: 1,
          issue_id: 1,
          body: 'Historical comment',
          author: 'Original author',
          created_at: at,
        }],
        work_logs: [{
          id: 1,
          issue_id: 1,
          kind: 'decision',
          summary: 'Historical decision',
          body: 'Reason',
          actor_subject: null,
          created_at: at,
        }],
        issue_delegations: [{
          id: 1,
          issue_id: 1,
          agent: 'codex',
          session_id: 'old-session',
          agent_id: '',
          agent_type: '',
          hostname: 'old-host',
          actor_subject: 'old-uc',
          created_at: at,
        }],
        issue_assignments: [{
          id: 1,
          issue_id: 1,
          actor_subject: null,
          from_subject: null,
          to_subject: 'old-uc',
          created_at: at,
        }],
        events: [{ id: 1, issue_id: 1, kind: 'created', detail: 'todo', created_at: at }],
        relations: [{ issue_id: 1, kind: 'related', other_id: 2 }],
        links: [{ id: 1, issue_id: 1, title: 'Reference', url: 'https://example.com/reference' }],
        pull_requests: [{
          workspace_id: 1,
          repo: 'owner/repo',
          number: 1,
          title: 'AA-1',
          url: 'https://github.com/owner/repo/pull/1',
          head_ref: 'aa-1',
          state: 'open',
          issue_identifier: 'AA-1',
          updated_at: at,
          linkback_posted_at: null,
        }],
        github_sync: [{ workspace_id: 1, repo: 'owner/repo', last_updated_at: at }],
        specs: [{
          id: 41,
          workspace_id: 1,
          team_id: 1,
          number: 7,
          current_revision: 3,
          created_at: at,
          updated_at: '2026-01-03T00:00:00.000Z',
        }],
        spec_revisions: [{
          id: 71,
          spec_id: 41,
          number: 1,
          content: JSON.stringify(originalSpec),
          message: 'Initial / 原稿',
          author_subject: 'old-uc',
          created_at: at,
        }, {
          id: 72,
          spec_id: 41,
          number: 2,
          content: JSON.stringify(removedSpec),
          message: 'Retire stable IDs',
          author_subject: null,
          created_at: '2026-01-02T00:00:00.000Z',
        }, {
          id: 73,
          spec_id: 41,
          number: 3,
          content: JSON.stringify(currentSpec),
          message: '审核通过',
          author_subject: 'old-uc',
          created_at: '2026-01-03T00:00:00.000Z',
        }],
      },
    };
    let wid: string | undefined;
    let runtime: ReturnType<typeof createDatabase> | undefined;
    try {
      const bad = structuredClone(snapshot);
      bad.tables.issues[1].parent_id = 999;
      let failed = false;
      try {
        await importSQLite(setup, bad, { subjects: { 'old-uc': subject } });
      } catch {
        failed = true;
      }
      assert(failed);
      assert(
        (await setup.query('select count(*)::int n from roster.workspaces')).rows[0].n === 0,
        'Invalid snapshot rolls back all writes',
      );
      const invalidSpecs: SQLiteSnapshot[] = [];
      const invalidJSON = structuredClone(snapshot);
      invalidJSON.tables.spec_revisions[0].content = '{bad json';
      invalidSpecs.push(invalidJSON);
      const missingRevision = structuredClone(snapshot);
      missingRevision.tables.spec_revisions.splice(1, 1);
      invalidSpecs.push(missingRevision);
      const mismatchedHead = structuredClone(snapshot);
      mismatchedHead.tables.specs[0].current_revision = 2;
      invalidSpecs.push(mismatchedHead);
      const unknownAuthor = structuredClone(snapshot);
      unknownAuthor.tables.spec_revisions[2].author_subject = 'unmapped-author';
      invalidSpecs.push(unknownAuthor);
      const oversized = structuredClone(snapshot);
      oversized.tables.spec_revisions[2].content = JSON.stringify({
        ...currentSpec,
        edge_cases: ['x'.repeat(300 * 1024)],
      });
      invalidSpecs.push(oversized);
      for (const kind of ['stories', 'requirements', 'success_criteria'] as const) {
        const reused = structuredClone(snapshot);
        reused.tables.spec_revisions[2].content = JSON.stringify({
          ...currentSpec,
          [kind]: originalSpec[kind],
        });
        invalidSpecs.push(reused);
      }
      for (const invalid of invalidSpecs) {
        failed = false;
        try {
          await importSQLite(setup, invalid, { subjects: { 'old-uc': subject } });
        } catch {
          failed = true;
        }
        assert(failed, 'Invalid Spec history must reject the whole import');
        const remaining = await setup.query(
          'select (select count(*) from roster.workspaces)+(select count(*) from roster.issues)+(select count(*) from roster.specs)+(select count(*) from roster.spec_revisions) as n',
        );
        assert(
          Number(remaining.rows[0].n) === 0,
          'Failed Spec imports must roll back core data and append-only history together',
        );
      }
      const result = await importSQLite(setup, snapshot, { subjects: { 'old-uc': subject } });
      wid = result.workspaces['1'];
      assert(result.counts.issues === 2 && result.counts.comments === 1);
      const runtimeUrl = new URL(url!);
      runtimeUrl.username = 'roster_test_runtime';
      runtime = createDatabase(runtimeUrl.toString());
      const service = createService(runtime.db);
      const ctx = { identity: { subject, name: 'Imported user', email: 'import@test.local' } };
      assert(result.counts.specs === 1 && result.counts.spec_revisions === 3);
      const importedSpec = await service.getSpec(ctx, 'import-fixture', 'SPEC-7');
      assert(
        importedSpec.revision === 3 && importedSpec.content.status === 'approved' &&
          importedSpec.author?.subject === subject && importedSpec.message === '审核通过',
      );
      const importedHistory = await service.listSpecRevisions(ctx, 'import-fixture', 'SPEC-7');
      assert(
        importedHistory.map((revision) => revision.number).join(',') === '3,2,1' &&
          importedHistory[1].author === null,
        'Full revision sequence and unknown historical author are preserved',
      );
      const oldRevision = await service.getSpecRevision(ctx, 'import-fixture', {
        identifier: 'SPEC-7',
        number: 1,
      });
      assert(
        JSON.stringify(oldRevision.content) === JSON.stringify(originalSpec) &&
          oldRevision.message === 'Initial / 原稿',
      );
      const identityRows = await setup.query(
        'select id,author_subject from roster.spec_revisions order by id',
      );
      assert(
        identityRows.rows.map((row: { id: number; author_subject: string | null }) => row.id).join(
              ',',
            ) === '71,72,73' &&
          identityRows.rows[0].author_subject === subject &&
          identityRows.rows[1].author_subject === null,
        'Numeric revision IDs and trusted/NULL authors survive remapping',
      );
      assert((await setup.query('select id from roster.specs')).rows[0].id === 41);
      failed = false;
      try {
        await service.updateSpec(ctx, 'import-fixture', {
          identifier: 'SPEC-7',
          base_revision: 3,
          content: originalSpec,
        });
      } catch {
        failed = true;
      }
      assert(
        failed && (await service.listSpecRevisions(ctx, 'import-fixture', 'SPEC-7')).length === 3,
        'Imported stable-ID tombstones remain enforced after migration',
      );
      const savedSpec = await service.updateSpec(ctx, 'import-fixture', {
        identifier: 'SPEC-7',
        base_revision: 3,
        content: { ...currentSpec, title: 'After import' },
      });
      assert(savedSpec.revision === 4);
      const nextSpec = await service.createSpec(ctx, 'import-fixture', {
        team: 'AA',
        content: currentSpec,
      });
      assert(
        nextSpec.identifier === 'SPEC-8',
        'SPEC workspace numbering continues from imported numbers',
      );
      assert(
        (await setup.query('select id from roster.specs where number=8')).rows[0].id > 41 &&
          (await setup.query('select max(id) as n from roster.spec_revisions')).rows[0].n > 73,
        'Numeric identity sequences advance past preserved IDs',
      );
      assert(
        JSON.stringify(
          (await service.getSpecRevision(ctx, 'import-fixture', {
            identifier: 'SPEC-7',
            number: 1,
          })).content,
        ) === JSON.stringify(originalSpec),
        'Appending new revisions must not mutate imported history',
      );

      const issue = await service.getIssue(ctx, 'import-fixture', 'AA-1');
      assert(
        issue.labels.length === 1 && issue.comments[0].author === 'Original author' &&
          issue.decisions[0].actor === null && issue.children[0].identifier === 'AA-2' &&
          issue.pull_requests.length === 1,
      );
      const next = await service.createIssue(ctx, 'import-fixture', {
        team: 'AA',
        title: 'After import',
      });
      assert(next.identifier === 'AA-20', 'Team numbering survives migration');
      failed = false;
      try {
        await importSQLite(setup, snapshot, { subjects: { 'old-uc': subject } });
      } catch {
        failed = true;
      }
      assert(failed, 'A second import never overwrites workspaces');
      const linear = {
        identifier: 'AA-10',
        number: 10,
        title: 'From Linear',
        description: 'Preserved',
        priority: 3,
        createdAt: at,
        updatedAt: at,
        state: { name: 'Done' },
        project: { name: 'Linear project' },
        labels: [{ name: 'Feature' }],
        relations: [],
        attachments: [
          { sourceType: 'url', title: 'Imported reference', url: 'https://example.com/reference' },
          {
            sourceType: 'github',
            title: 'Handled by sync',
            url: 'https://github.com/owner/repo/pull/1',
          },
        ],
        comments: [{ body: 'Original author preserved', createdAt: at, user: { name: 'Alice' } }],
      };
      failed = false;
      try {
        await importLinear(setup, 'import-fixture', 'AA', [{
          ...linear,
          state: { name: 'Unknown' },
        }], [{ name: 'Should roll back', state: 'started' }]);
      } catch {
        failed = true;
      }
      assert(failed);
      assert(
        !(await setup.query("select 1 from roster.projects where name='Should roll back'")).rows
          .length,
      );
      const imported = await importLinear(setup, 'import-fixture', 'AA', [linear], [{
        name: 'Linear project',
        state: 'completed',
        description: 'Project',
      }]);
      assert(imported.issues === 1 && imported.comments === 1 && imported.links === 1);
      assert(
        (await service.getIssue(ctx, 'import-fixture', 'AA-10')).comments[0].author === 'Alice',
      );
      await cleanupWorkspace(setup, wid!);
      wid = undefined;
      await setup.query('delete from roster.users where subject=$1', [subject]);
      const olderSnapshot = structuredClone(snapshot);
      delete olderSnapshot.tables.specs;
      delete olderSnapshot.tables.spec_revisions;
      const olderResult = await importSQLite(setup, olderSnapshot, {
        subjects: { 'old-uc': subject },
      });
      wid = olderResult.workspaces['1'];
      assert(
        (await service.listSpecs(ctx, 'import-fixture')).length === 0 &&
          (await service.getIssue(ctx, 'import-fixture', 'AA-1')).title === 'Imported parent',
        'Snapshots without Spec tables remain importable',
      );
    } finally {
      if (wid) await cleanupWorkspace(setup, wid);
      await setup.query('delete from roster.users where subject=$1', [subject]);
      if (runtime) await runtime.pool.end();
      await setup.end();
    }
  },
});
