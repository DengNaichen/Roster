import { Pool } from 'npm:pg@8.23.1';
import { AppError, type RequestContext } from '../../../contracts/mod.ts';
import {
  createSpecSchema,
  type EditableSpecContent,
  type SpecContent,
} from '../../../contracts/spec.ts';
import { createDatabase } from '../platform/database/client.ts';
import { createService } from '../service.ts';
import { cleanupWorkspace, prepareTestDatabase } from '../test_support.ts';
import { exerciseSpecTransports } from '../transport/spec_test.ts';
import { encodeSpec } from './specs/index.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof AppError, `${e}`);
    assert(e.code === code, `Expected ${code}, got ${e.code}: ${e.message}`);
    return;
  }
  throw new Error('Expected ' + code);
}
async function dbReject(fn: () => Promise<unknown>, code?: string) {
  try {
    await fn();
  } catch (e) {
    if (code) assert((e as { code?: string }).code === code, `${e}`);
    return;
  }
  throw new Error('Database accepted a forbidden mutation');
}
function sample(): EditableSpecContent {
  return {
    title: 'Specs as entities',
    status: 'draft',
    stories: [{
      id: 'US-1',
      title: 'Read a spec',
      priority: 'P1',
      description: 'Open the page.',
      why: 'Core value.',
      independent_test: 'Open it.',
      scenarios: [{ given: 'a spec', when: 'I open it', then: 'I see it' }],
    }],
    edge_cases: ['What if empty?'],
    requirements: [{ id: 'FR-001', text: 'System MUST store specs.' }, {
      id: 'FR-002',
      text: 'System MUST keep revisions.',
      clarify: 'How many?',
    }],
    entities: [{ name: 'Spec', description: 'A document.' }],
    success_criteria: [{ id: 'SC-001', text: 'Found in 5 seconds.' }],
    clarifications: [{ date: '2026-11-01', items: [{ question: 'Where?', answer: 'InfTask.' }] }],
  };
}
Deno.test('Spec validates structured content, stable IDs, Unicode messages and UTF-8 size before storage', () => {
  assert(
    createSpecSchema.safeParse({ team: 'AL', content: sample(), message: '😀'.repeat(240) })
      .success,
  );
  for (const message of ['😀'.repeat(241), 'two\nlines', '\u0085', '\ud800']) {
    assert(
      !createSpecSchema.safeParse({ team: 'AL', content: sample(), message }).success,
      'Invalid message accepted',
    );
  }
  const mutations: ((c: SpecContent) => void)[] = [
    (c) => c.title = ' ',
    (c) => c.title = '\ud800',
    (c) => c.status = 'done' as never,
    (c) => c.stories[0].priority = 'P4' as never,
    (c) => c.stories[0].title = '',
    (c) => c.stories[0].scenarios[0].then = '',
    (c) => c.stories[0].id = 'STORY-1',
    (c) => c.requirements[0].id = 'REQ-1',
    (c) => c.success_criteria[0].id = 'FR-001',
    (c) => c.requirements[1].id = 'FR-001',
    (c) => c.requirements[0].text = '',
    (c) => c.clarifications[0].date = '2026-02-30',
    (c) => c.clarifications[0].items[0].answer = '',
    (c) => c.entities[0].name = '',
  ];
  for (const mutate of mutations) {
    const content = sample();
    mutate(content);
    assert(!createSpecSchema.safeParse({ team: 'AL', content }).success);
  }
  const minimal = createSpecSchema.parse({
    team: 'AL',
    content: { title: 'Minimal', status: 'draft', stories: null },
  }).content;
  assert(
    minimal.stories.length === 0 && minimal.clarifications.length === 0 &&
      minimal.success_criteria.length === 0,
  );
  assert(
    !createSpecSchema.safeParse({ team: 'AL', content: sample(), author_subject: 'spoof' }).success,
  );
  const content = sample();
  content.edge_cases = ['汉'.repeat(100000)];
  try {
    encodeSpec(content);
    throw new Error('Oversized UTF-8 accepted');
  } catch (e) {
    assert(e instanceof AppError && e.code === 'invalid_input');
  }
  const base = sample();
  base.edge_cases = [''];
  const bytes = new TextEncoder().encode(encodeSpec(base)).length;
  base.edge_cases = ['x'.repeat(256 * 1024 - bytes)];
  assert(
    new TextEncoder().encode(encodeSpec(base)).length === 256 * 1024,
    'Exactly 256 KiB must fit',
  );
  base.edge_cases[0] += 'x';
  try {
    encodeSpec(base);
    throw new Error('Size boundary accepted');
  } catch (e) {
    assert(e instanceof AppError && e.code === 'invalid_input');
  }
  assert(
    encodeSpec({ ...minimal, edge_cases: ['<>&\u2028'] }).includes('\\u003c\\u003e\\u0026\\u2028'),
    'Encoding matches Go JSON HTML escaping',
  );
});
const url = Deno.env.get('ROSTER_TEST_DATABASE_URL');
Deno.test({
  name:
    'Postgres SPEC entities: immutable revisions, optimistic concurrency, retired IDs, visibility, trusted/null authors and REST/MCP',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assert(url && new URL(url).pathname.endsWith('_test'));
    const admin = new Pool({ connectionString: url });
    let runtime: ReturnType<typeof createDatabase> | undefined;
    const contexts: RequestContext[] = Array.from(
      { length: 3 },
      (_, i) => ({
        identity: { subject: crypto.randomUUID(), name: 'Spec ' + i, email: i + '@example.test' },
      }),
    );
    const [owner, member, outsider] = contexts;
    const workspaceIds: string[] = [];
    try {
      await prepareTestDatabase(admin);
      const runtimeUrl = new URL(url);
      runtimeUrl.username = 'roster_test_runtime';
      runtime = createDatabase(runtimeUrl.toString());
      const s = createService(runtime.db);
      const w = await s.createWorkspace(owner, {
        slug: 's-' + crypto.randomUUID(),
        name: 'Specs fixture',
      });
      workspaceIds.push(w.id);
      const other = await s.createWorkspace(outsider, {
        slug: 's-' + crypto.randomUUID(),
        name: 'Other',
      });
      workspaceIds.push(other.id);
      await s.joinWorkspace(member, await s.resetInvite(owner, w.slug));
      await s.createTeam(owner, w.slug, { key: 'AL', name: 'Public' });
      await s.createTeam(member, w.slug, { key: 'SEC', name: 'Private', private: true });
      await s.createTeam(outsider, other.slug, { key: 'BB', name: 'Other' });
      const first = sample();
      const created = await s.createSpec(owner, w.slug, {
        team: 'AL',
        content: first,
        message: 'Initial draft',
      });
      assert(
        created.identifier === 'SPEC-1' && created.revision === 1 &&
          created.author?.subject === owner.identity.subject,
      );
      assert(JSON.stringify(created.content) === JSON.stringify(first));
      const content = sample();
      content.status = 'review';
      content.requirements.push({ id: 'FR-003', text: 'System MUST list specs.' });
      const updated = await s.updateSpec(member, w.slug, {
        identifier: created.identifier,
        base_revision: 1,
        content,
        message: 'Add listing',
      });
      assert(updated.revision === 2 && updated.author?.subject === member.identity.subject);
      assert((await s.getSpec(owner, w.slug, created.identifier)).content.title === first.title);
      const history = await s.listSpecRevisions(owner, w.slug, created.identifier);
      assert(
        history.map((r) => r.number).join(',') === '2,1' && history[0].message === 'Add listing',
      );
      assert(
        JSON.stringify(
          (await s.getSpecRevision(owner, w.slug, { identifier: created.identifier, number: 1 }))
            .content,
        ) === JSON.stringify(first),
      );
      await rejects(() =>
        s.updateSpec(owner, w.slug, {
          identifier: created.identifier,
          base_revision: 1,
          content: first,
        }), 'conflict');
      const race = await Promise.allSettled([
        s.updateSpec(owner, w.slug, { identifier: created.identifier, base_revision: 2, content }),
        s.updateSpec(member, w.slug, { identifier: created.identifier, base_revision: 2, content }),
      ]);
      assert(
        race.filter((r) => r.status === 'fulfilled').length === 1,
        'Only one writer may save from a base revision',
      );
      assert((await s.listSpecRevisions(owner, w.slug, created.identifier)).length === 3);
      const others = await Promise.all(
        Array.from(
          { length: 8 },
          () => s.createSpec(owner, w.slug, { team: 'AL', content: sample() }),
        ),
      );
      assert(
        new Set(others.map((sp) => sp.identifier)).size === 8 &&
          others.some((sp) => sp.identifier === 'SPEC-9'),
        'Concurrent numbering must be unique, ordered per workspace',
      );
      for (const kind of ['stories', 'requirements', 'success_criteria'] as const) {
        const original = sample();
        const spec = await s.createSpec(owner, w.slug, { team: 'AL', content: original });
        const removed = sample();
        removed[kind] = [];
        await s.updateSpec(owner, w.slug, {
          identifier: spec.identifier,
          base_revision: 1,
          content: removed,
        });
        await rejects(() =>
          s.updateSpec(owner, w.slug, {
            identifier: spec.identifier,
            base_revision: 2,
            content: original,
          }), 'invalid_input');
        const fresh = sample();
        for (const item of fresh[kind]) {
          item.id = item.id.replace(/[0-9]+$/, (n) => String(Number(n) + 10));
        }
        assert(
          (await s.updateSpec(owner, w.slug, {
            identifier: spec.identifier,
            base_revision: 2,
            content: fresh,
          })).revision === 3,
        );
      }
      await rejects(
        () => s.createSpec(owner, w.slug, { team: 'SEC', content: sample() }),
        'not_found',
      );
      const hidden = await s.createSpec(member, w.slug, { team: 'SEC', content: sample() });
      const graphSpec = await s.createSpec(owner, w.slug, { team: 'AL', content: sample() });
      const leaf = await s.createIssue(owner, w.slug, { team: 'AL', title: 'Dependency leaf' });
      const root = await s.createIssue(owner, w.slug, {
        team: 'AL',
        title: 'External prerequisite',
      });
      const middle = await s.createIssue(owner, w.slug, {
        team: 'AL',
        title: 'Middle prerequisite',
      });
      const secret = await s.createIssue(member, w.slug, {
        team: 'SEC',
        title: 'Hidden prerequisite',
      });
      const behind = await s.createIssue(owner, w.slug, {
        team: 'AL',
        title: 'Only reachable through secret',
      });
      assert((await s.getSpecDependencies(owner, w.slug, graphSpec.identifier)).nodes.length === 0);
      await s.linkSpecIssues(owner, w.slug, {
        identifier: graphSpec.identifier,
        issues: [leaf.identifier],
      });
      for (const [a, b] of [[root, middle], [middle, leaf], [secret, leaf], [behind, secret]]) {
        await s.addRelation(member, w.slug, {
          identifier: a.identifier,
          other: b.identifier,
          kind: 'blocks',
        });
      }
      await s.addRelation(owner, w.slug, {
        identifier: root.identifier,
        other: leaf.identifier,
        kind: 'related',
      });
      const graph = await s.getSpecDependencies(owner, w.slug, graphSpec.identifier);
      assert(graph.nodes.length === 3 && graph.edges.length === 2);
      assert(graph.nodes.find((n) => n.id === leaf.id)?.external === false);
      assert(graph.nodes.find((n) => n.id === root.id)?.external === true);
      assert(
        !JSON.stringify(graph).includes(secret.id) && !JSON.stringify(graph).includes(behind.id),
      );
      const fullGraph = await s.getSpecDependencies(member, w.slug, graphSpec.identifier);
      assert(fullGraph.nodes.length === 5 && fullGraph.edges.length === 4);
      await rejects(
        () => s.getSpecDependencies(outsider, w.slug, graphSpec.identifier),
        'forbidden',
      );
      assert(hidden.author?.subject === member.identity.subject);
      for (
        const fn of [
          () => s.getSpec(owner, w.slug, hidden.identifier),
          () => s.getSpecDesign(owner, w.slug, hidden.identifier),
          () => s.getSpecDependencies(owner, w.slug, hidden.identifier),
          () =>
            s.setSpecDesign(owner, w.slug, {
              identifier: hidden.identifier,
              base_revision: 0,
              spec_revision: 1,
              content: { decisions: [{ title: 'Hidden' }] },
            }),
          () =>
            s.updateSpec(owner, w.slug, {
              identifier: hidden.identifier,
              base_revision: 1,
              content: sample(),
            }),
          () => s.listSpecRevisions(owner, w.slug, hidden.identifier),
          () => s.getSpecRevision(owner, w.slug, { identifier: hidden.identifier, number: 1 }),
          () => s.listSpecs(owner, w.slug, { team: 'SEC' }),
        ]
      ) {
        await rejects(fn, 'not_found');
      }
      assert(
        !(await s.listSpecs(owner, w.slug)).some((sp) => sp.identifier === hidden.identifier),
      );
      assert((await s.listSpecs(member, w.slug, { team: 'SEC' })).length === 1);
      await rejects(() => s.getSpec(outsider, other.slug, created.identifier), 'not_found');
      await rejects(() => s.getSpec(owner, w.slug, 'SPEC-0'), 'not_found');
      await rejects(
        () => s.getSpecRevision(owner, w.slug, { identifier: created.identifier, number: 999 }),
        'not_found',
      );
      const sp =
        (await admin.query('select id from roster.specs where workspace_id=$1 and number=1', [
          w.id,
        ])).rows[0];
      await dbReject(
        () =>
          runtime!.pool.query(
            "update roster.spec_revisions set message='edited' where spec_id=$1",
            [
              sp.id,
            ],
          ),
        '42501',
      );
      await dbReject(
        () => runtime!.pool.query('delete from roster.spec_revisions where spec_id=$1', [sp.id]),
        '42501',
      );
      await dbReject(
        () =>
          admin.query("update roster.spec_revisions set message='edited' where spec_id=$1", [
            sp.id,
          ]),
        '55000',
      );
      await dbReject(
        () => admin.query('delete from roster.spec_revisions where spec_id=$1', [sp.id]),
        '55000',
      );
      const otherTeam =
        (await admin.query('select id from roster.teams where workspace_id=$1', [other.id]))
          .rows[0];
      await dbReject(() =>
        runtime!.pool.query(
          'insert into roster.specs(workspace_id,team_id,number,current_revision) values($1,$2,99,1)',
          [w.id, otherTeam.id],
        ), '23503');
      await dbReject(() =>
        runtime!.pool.query(
          'insert into roster.spec_revisions(spec_id,number,content) values($1,999,$2::json)',
          [sp.id, JSON.stringify({ title: 'x'.repeat(300 * 1024) })],
        ), '23514');
      // Only the privileged import/setup connection may insert a legacy snapshot without an author.
      const team =
        (await admin.query("select id from roster.teams where workspace_id=$1 and key='AL'", [
          w.id,
        ])).rows[0];
      const legacy = (await admin.query(
        'insert into roster.specs(workspace_id,team_id,number,current_revision) values($1,$2,99,1) returning id',
        [w.id, team.id],
      )).rows[0];
      await admin.query(
        "insert into roster.spec_revisions(spec_id,number,content,message,author_subject) values($1,1,$2::json,'Imported',null)",
        [legacy.id, JSON.stringify({ ...sample(), status: 'approved' })],
      );
      const legacySpec = await s.getSpec(owner, w.slug, 'SPEC-99');
      assert(legacySpec.author === null && legacySpec.content.status === 'active');
      assert(legacySpec.active_revision?.number === 1);
      const proposed = { ...sample(), status: 'review' as const, title: 'Proposed new title' };
      const inReview = await s.updateSpec(owner, w.slug, {
        identifier: 'SPEC-99',
        base_revision: 1,
        content: proposed,
      });
      assert(inReview.content.status === 'review' && inReview.active_revision?.number === 1);
      const listed = (await s.listSpecs(owner, w.slug)).find((x) => x.identifier === 'SPEC-99');
      assert(listed?.active_revision?.title === legacySpec.content.title && listed.revision === 2);
      const adopted = await s.updateSpec(owner, w.slug, {
        identifier: 'SPEC-99',
        base_revision: 2,
        content: { ...proposed, status: 'active' },
      });
      assert(
        adopted.active_revision?.number === 3 && adopted.active_revision.title === proposed.title,
      );
      // A retired legacy spec stays retired even if a new draft is subsequently proposed.
      await admin.query(
        'insert into roster.spec_revisions(spec_id,number,content) values($1,4,$2::json)',
        [
          legacy.id,
          JSON.stringify({ ...sample(), status: 'superseded' }),
        ],
      );
      await admin.query('update roster.specs set current_revision=4 where id=$1', [legacy.id]);
      assert(
        (await s.getSpecRevision(owner, w.slug, { identifier: 'SPEC-99', number: 4 })).content
          .status === 'superseded',
      );
      const reopened = await s.updateSpec(owner, w.slug, {
        identifier: 'SPEC-99',
        base_revision: 4,
        content: sample(),
      });
      assert(reopened.active_revision === null && reopened.content.status === 'draft');
      for (const status of ['superseded', 'archived']) {
        assert(
          !createSpecSchema.safeParse({ team: 'AL', content: { ...sample(), status } }).success,
        );
      }
      await exerciseSpecTransports(s, owner, w.slug, 'AL');
      await s.updateMember(owner, w.slug, {
        subject: member.identity.subject,
        role: 'member',
        status: 'suspended',
      });
      await rejects(() => s.getSpec(member, w.slug, hidden.identifier), 'forbidden');
    } finally {
      await runtime?.pool.end();
      for (const id of workspaceIds) {
        await cleanupWorkspace(admin, id);
      }
      await admin.query('delete from roster.users where subject=any($1::text[])', [
        contexts.map((c) => c.identity.subject),
      ]);
      await admin.end();
    }
  },
});
