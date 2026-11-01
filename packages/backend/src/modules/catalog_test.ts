import { sql } from 'npm:drizzle-orm@0.45.4';
import { Pool } from 'npm:pg@8.23.1';
import { createDatabase } from '../db/client.ts';
import { AppError, type RequestContext } from '../../../contracts/mod.ts';
import { isValidEmoji } from '../../../contracts/catalog.ts';
import {
  buildLabelFilter,
  createCatalogService,
  hydrateIssueCatalog,
  resolveIssueProject,
} from './catalog.ts';
import { rows } from './shared.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
async function rejects(write: () => Promise<unknown>, code: string) {
  try {
    await write();
  } catch (error) {
    assert(error instanceof AppError, `Expected AppError, received ${error}`);
    equal(error.code, code);
    return;
  }
  throw new Error(`Expected ${code} rejection`);
}
const url = Deno.env.get('ROSTER_TEST_DATABASE_URL');
Deno.test({
  name:
    'Postgres catalog: private visibility, project/initiative retention, atomic labels and database invariants',
  ignore: !url,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    assert(url);
    const parsed = new URL(url);
    assert(
      parsed.hostname === '127.0.0.1' && parsed.pathname.endsWith('_test'),
      'Only isolated loopback *_test databases are allowed',
    );
    const setup = new Pool({ connectionString: url });
    const runtimeUrl = new URL(url);
    runtimeUrl.searchParams.set('options', '-c role=roster_app');
    const runtime = createDatabase(runtimeUrl.toString());
    const db = runtime.db;
    const catalog = createCatalogService(db);
    const people: RequestContext[] = ['Owner', 'Member', 'Admin'].map((name) => ({
      identity: { subject: crypto.randomUUID(), name, email: `${name}@example.test` },
    }));
    const [owner, member, admin] = people;
    const slug = `catalog-${crypto.randomUUID()}`;
    const otherSlug = `catalog-${crypto.randomUUID()}`;
    let wid = '', otherWid = '';
    try {
      const role = await runtime.pool.query(
        'select current_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user',
      );
      equal(role.rows[0].current_user, 'roster_app');
      assert(!role.rows[0].rolsuper && !role.rows[0].rolbypassrls);
      assert(
        (await setup.query("select to_regclass('roster.projects') as name")).rows[0].name,
        'Apply initial and catalog migrations before running this domain suite',
      );
      for (const { identity: p } of people) {
        await db.execute(sql`insert into roster.users values(${p.subject},${p.name},${p.email})`);
      }
      wid = String(
        (await rows(
          db,
          sql`insert into roster.workspaces(slug,name) values(${slug},'Catalog test') returning id`,
        ))[0].id,
      );
      otherWid = String(
        (await rows(
          db,
          sql`insert into roster.workspaces(slug,name) values(${otherSlug},'Other workspace') returning id`,
        ))[0].id,
      );
      for (const w of [wid, otherWid]) {
        for (const p of people) {
          await db.execute(
            sql`insert into roster.workspace_members values(${w},${p.identity.subject},${
              p === member ? 'member' : 'admin'
            },'active')`,
          );
        }
      }
      const ts: Record<string, string> = {};
      for (const key of ['PUB', 'ALT', 'SEC']) {
        ts[key] = String(
          (await rows(
            db,
            sql`insert into roster.teams(workspace_id,key,name,private) values(${wid},${key},${key},${
              key === 'SEC'
            }) returning id`,
          ))[0].id,
        );
      }
      await db.execute(
        sql`insert into roster.team_members values(${wid},${ts.SEC},${owner.identity.subject},'owner')`,
      );
      await db.execute(
        sql`insert into roster.teams(workspace_id,key,name) values(${otherWid},'EXT','External')`,
      );
      const issueIds: Record<string, string> = {};
      for (const [identifier, key] of [['PUB-1', 'PUB'], ['PUB-2', 'PUB'], ['SEC-1', 'SEC']]) {
        issueIds[identifier] = String(
          (await rows(
            db,
            sql`insert into roster.issues(workspace_id,team_id,number,identifier,title) values(${wid},${
              ts[key]
            },${identifier.endsWith('2') ? 2 : 1},${identifier},${identifier}) returning id`,
          ))[0].id,
        );
      }
      let sharedId = 0, hiddenId = 0, publicId = 0;
      await t.step(
        'strict inputs, dates, exact emoji data and projects preserve hidden associations atomically',
        async () => {
          assert(isValidEmoji(''));
          assert(isValidEmoji('😀'));
          assert(!isValidEmoji('abc😀'));
          assert(!isValidEmoji('plain text'));
          await rejects(
            () => catalog.createProject(owner, slug, { name: 'Empty', teams: [] }),
            'invalid_input',
          );
          await rejects(
            () =>
              catalog.createProject(owner, slug, { name: 'Emoji', teams: ['PUB'], emoji: 'abc😀' }),
            'invalid_input',
          );
          await rejects(
            () =>
              catalog.createProject(owner, slug, {
                name: 'Date',
                teams: ['PUB'],
                start_date: '2026-02-30',
              }),
            'invalid_input',
          );
          await rejects(
            () =>
              catalog.createProject(owner, slug, {
                name: 'Dates',
                teams: ['PUB'],
                start_date: '2026-03-02',
                target_date: '2026-03-01',
              }),
            'invalid_input',
          );
          const shared = await catalog.createProject(owner, slug, {
            name: ' Shared ',
            description: 'Outcome',
            teams: ['PUB', 'SEC', 'PUB'],
            start_date: '2026-01-01',
            target_date: '2026-02-01',
          });
          sharedId = shared.id;
          equal((await catalog.getProject(owner, slug, { id: 0, name: 'Shared' })).id, sharedId);
          equal((await catalog.getProject(owner, slug, { id: sharedId, name: '' })).id, sharedId);
          equal(typeof shared.id, 'number');
          equal(shared.teams, ['PUB', 'SEC']);
          equal(shared.name, 'Shared');
          equal(shared.start_date, '2026-01-01');
          hiddenId =
            (await catalog.createProject(owner, slug, { name: 'Hidden', teams: ['SEC'] })).id;
          publicId =
            (await catalog.createProject(owner, slug, { name: 'Public', teams: ['PUB'] })).id;
          await rejects(
            () => catalog.createProject(owner, slug, { name: 'Shared', teams: ['PUB'] }),
            'conflict',
          );
          equal((await catalog.getProject(member, slug, { id: sharedId })).teams, ['PUB']);
          await rejects(() => catalog.getProject(member, slug, { id: hiddenId }), 'not_found');
          await rejects(() => catalog.getProject(admin, slug, { id: hiddenId }), 'not_found');
          await rejects(() => catalog.getProject(owner, otherSlug, { id: sharedId }), 'not_found');
          await rejects(
            () => catalog.getProject(owner, slug, { id: sharedId, name: 'Public' }),
            'invalid_input',
          );
          await db.execute(
            sql`update roster.issues set project_id=${sharedId} where id=${issueIds['PUB-1']}`,
          );
          await rejects(
            () =>
              catalog.updateProject(member, slug, {
                id: sharedId,
                new_name: 'Should roll back',
                teams: ['ALT'],
              }),
            'conflict',
          );
          equal((await catalog.getProject(owner, slug, { id: sharedId })).name, 'Shared');
          await db.execute(
            sql`update roster.issues set project_id=null where id=${issueIds['PUB-1']}`,
          );
          const changed = await catalog.updateProject(member, slug, {
            id: sharedId,
            teams: ['ALT'],
          });
          equal(changed.teams, ['ALT']);
          equal((await catalog.getProject(owner, slug, { id: sharedId })).teams, ['ALT', 'SEC']);
          await rejects(
            () => catalog.updateProject(member, slug, { id: sharedId, teams: ['ALT', 'SEC'] }),
            'not_found',
          );
          equal(
            (await catalog.updateProject(owner, slug, {
              id: sharedId,
              start_date: '',
              target_date: '',
              emoji: '',
            })).start_date,
            undefined,
          );
          equal(
            await resolveIssueProject(db, owner, wid, ts.PUB, { project_id: publicId }, null),
            publicId,
          );
          await catalog.updateProject(owner, slug, { id: publicId, archived: true });
          await rejects(
            () => resolveIssueProject(db, owner, wid, ts.PUB, { project_id: publicId }, null),
            'conflict',
          );
          equal(
            await resolveIssueProject(db, owner, wid, ts.PUB, { project_id: publicId }, publicId),
            publicId,
          );
          equal(
            await resolveIssueProject(db, owner, wid, ts.PUB, { project_id: 0 }, publicId),
            null,
          );
          await rejects(
            () => resolveIssueProject(db, owner, wid, ts.ALT, { project_id: publicId }, null),
            'invalid_input',
          );
          await rejects(
            () =>
              resolveIssueProject(
                db,
                owner,
                wid,
                ts.PUB,
                { project_id: publicId, project: '' },
                null,
              ),
            'invalid_input',
          );
          equal((await catalog.listProjects(member, slug)).some((p) => p.id === publicId), false);
          await catalog.updateProject(owner, slug, { id: publicId, archived: false });
        },
      );
      await t.step(
        'initiative replacement preserves hidden links and archive rules preserve existing links',
        async () => {
          const init = await catalog.createInitiative(owner, slug, {
            name: 'Initiative',
            project_ids: [sharedId, hiddenId],
          });
          equal((await catalog.getInitiative(member, slug, { id: init.id })).project_ids, [
            sharedId,
          ]);
          await catalog.updateInitiative(member, slug, { id: init.id, project_ids: [publicId] });
          equal(
            (await catalog.getInitiative(owner, slug, { id: init.id })).project_ids,
            [hiddenId, publicId].sort((a, b) => a - b),
          );
          await catalog.updateInitiative(member, slug, {
            id: init.id,
            archived: true,
            project_ids: [publicId],
          });
          await rejects(
            () =>
              catalog.updateInitiative(member, slug, {
                id: init.id,
                project_ids: [publicId, sharedId],
              }),
            'conflict',
          );
          equal((await catalog.listInitiatives(owner, slug)).length, 0);
          await catalog.updateInitiative(member, slug, { id: init.id, archived: false });
          await catalog.updateProject(owner, slug, { id: sharedId, archived: true });
          await rejects(
            () => catalog.updateInitiative(member, slug, { id: init.id, project_ids: [sharedId] }),
            'conflict',
          );
          equal(
            (await catalog.getInitiative(owner, slug, { id: init.id })).project_ids,
            [hiddenId, publicId].sort((a, b) => a - b),
          );
          await catalog.updateProject(owner, slug, { id: sharedId, archived: false });
          await rejects(
            () => catalog.getInitiative(owner, otherSlug, { id: init.id }),
            'not_found',
          );
        },
      );
      let groupId = 0, first = 0, second = 0, loose = 0;
      await t.step(
        'case-insensitive label/group uniqueness, group invariants and atomic private batches',
        async () => {
          const group = await catalog.saveLabelGroup(owner, slug, { id: 0, name: ' Status ' });
          groupId = group.id;
          equal(group.name, 'Status');
          await rejects(() => catalog.saveLabelGroup(owner, slug, { name: 'status' }), 'conflict');
          await catalog.saveLabelGroup(owner, slug, { id: groupId, name: ' State ' });
          equal((await catalog.listLabelGroups(member, slug))[0].name, 'State');
          first = (await catalog.createLabel(owner, slug, {
            name: ' Red ',
            color: '#ff0000',
            group_id: groupId,
          })).id;
          second = (await catalog.createLabel(owner, slug, {
            name: 'Blue',
            color: '#0000ff',
            group_id: groupId,
          })).id;
          loose = (await catalog.createLabel(owner, slug, { name: 'Red', color: '#ff0000' })).id;
          await rejects(
            () =>
              catalog.createLabel(owner, slug, {
                name: 'red',
                color: '#ff0000',
                group_id: groupId,
              }),
            'conflict',
          );
          await rejects(
            () => catalog.createLabel(owner, slug, { name: 'Bad color', color: 'red' }),
            'invalid_input',
          );
          await rejects(
            () =>
              catalog.createLabel(owner, otherSlug, {
                name: 'Cross',
                color: '#ff0000',
                group_id: groupId,
              }),
            'not_found',
          );
          await rejects(
            () => catalog.updateLabel(owner, slug, { id: first, group_id: 0 } as never),
            'invalid_input',
          );
          await rejects(
            () =>
              catalog.changeIssueLabels(member, slug, {
                identifiers: ['PUB-1', 'SEC-1'],
                add: [first],
              }),
            'not_found',
          );
          equal(
            (await rows(
              db,
              sql`select 1 from roster.issue_labels where issue_id=${issueIds['PUB-1']}`,
            )).length,
            0,
          );
          await catalog.changeIssueLabels(member, slug, {
            identifiers: ['PUB-1'],
            add: [first, first, loose],
          });
          await catalog.changeIssueLabels(member, slug, { identifiers: ['PUB-1'], add: [second] });
          const hydrated = await hydrateIssueCatalog(db, member, wid, [{ id: issueIds['PUB-1'] }]);
          equal(
            (hydrated[0].labels as { id: number }[]).map((l) => l.id).sort((a, b) => a - b),
            [second, loose].sort((a, b) => a - b),
          );
          await rejects(
            () =>
              catalog.changeIssueLabels(member, slug, {
                identifiers: ['PUB-1'],
                add: [first, second],
              }),
            'invalid_input',
          );
          await rejects(
            () =>
              catalog.changeIssueLabels(member, slug, {
                identifiers: ['PUB-1'],
                add: [second],
                remove: [second],
              }),
            'invalid_input',
          );
          await catalog.updateLabel(owner, slug, { id: second, archived: true });
          await catalog.changeIssueLabels(member, slug, { identifiers: ['PUB-1'], add: [second] });
          await rejects(
            () =>
              catalog.changeIssueLabels(member, slug, {
                identifiers: ['PUB-2', 'PUB-1'],
                add: [second],
              }),
            'invalid_input',
          );
          await catalog.changeIssueLabels(member, slug, {
            identifiers: ['PUB-1'],
            remove: [second],
          });
          await catalog.updateLabel(owner, slug, { id: second, archived: false });
          await Promise.all([
            catalog.changeIssueLabels(member, slug, { identifiers: ['PUB-1'], add: [first] }),
            catalog.changeIssueLabels(owner, slug, { identifiers: ['PUB-1'], add: [second] }),
          ]);
          equal(
            (await rows(
              db,
              sql`select 1 from roster.issue_labels where issue_id=${
                issueIds['PUB-1']
              } and group_id=${groupId}`,
            )).length,
            1,
          );
        },
      );
      await t.step(
        'label predicates compose with group selection and reject cross-workspace references',
        async () => {
          async function matching(input: Parameters<typeof buildLabelFilter>[2]) {
            const predicate = await buildLabelFilter(db, wid, input);
            return (await rows(
              db,
              sql`select i.identifier from roster.issues i where i.workspace_id=${wid} and ${predicate} order by i.identifier`,
            )).map((i) => i.identifier);
          }
          equal(await matching({ label_ids: [loose] }), ['PUB-1']);
          equal(
            await matching({ label_mode: 'all', label_ids: [loose], label_group_ids: [groupId] }),
            ['PUB-1'],
          );
          equal(await matching({ label_mode: 'none', label_ids: [loose] }), ['PUB-2', 'SEC-1']);
          equal(await matching({ label_mode: 'unlabeled' }), ['PUB-2', 'SEC-1']);
          await rejects(
            () => buildLabelFilter(db, wid, { label_mode: 'unlabeled', label_ids: [loose] }),
            'invalid_input',
          );
          await rejects(() => buildLabelFilter(db, otherWid, { label_ids: [loose] }), 'not_found');
        },
      );
      await t.step(
        'merges cannot mutate hidden issues, transfer atomically and remove source ids',
        async () => {
          const source = await catalog.createLabel(owner, slug, {
            name: 'Source',
            color: '#aaaaaa',
          });
          const target = await catalog.createLabel(owner, slug, {
            name: 'Target',
            color: '#bbbbbb',
          });
          await catalog.changeIssueLabels(owner, slug, {
            identifiers: ['PUB-1', 'SEC-1'],
            add: [source.id],
          });
          await rejects(
            () => catalog.mergeLabels(member, slug, { source_id: source.id, target_id: target.id }),
            'forbidden',
          );
          equal(
            (await rows(db, sql`select 1 from roster.issue_labels where label_id=${source.id}`))
              .length,
            2,
          );
          await rejects(
            () => catalog.mergeLabels(owner, slug, { source_id: source.id, target_id: first }),
            'invalid_input',
          );
          await catalog.mergeLabels(owner, slug, { source_id: source.id, target_id: target.id });
          equal(
            (await rows(db, sql`select 1 from roster.issue_labels where label_id=${target.id}`))
              .length,
            2,
          );
          equal(
            (await catalog.listLabels(owner, slug, { include_archived: true })).some((l) =>
              l.id === source.id
            ),
            false,
          );
          await rejects(
            () =>
              catalog.changeIssueLabels(owner, slug, { identifiers: ['PUB-1'], add: [source.id] }),
            'not_found',
          );
        },
      );
      await t.step(
        'database enforces cross-workspace junctions, fixed groups and group exclusivity',
        async () => {
          async function sqlReject(query: ReturnType<typeof sql>) {
            let rejected = false;
            try {
              await db.execute(query);
            } catch {
              rejected = true;
            }
            assert(rejected, 'Expected database constraint rejection');
          }
          await sqlReject(
            sql`insert into roster.project_teams(workspace_id,project_id,team_id) values(${otherWid},${sharedId},${ts.PUB})`,
          );
          await sqlReject(
            sql`insert into roster.issue_labels(workspace_id,issue_id,label_id) values(${otherWid},${
              issueIds['PUB-1']
            },${first})`,
          );
          await sqlReject(sql`update roster.labels set group_id=null where id=${first}`);
          await catalog.changeIssueLabels(owner, slug, { identifiers: ['PUB-2'], add: [first] });
          await sqlReject(
            sql`insert into roster.issue_labels(workspace_id,issue_id,label_id) values(${wid},${
              issueIds['PUB-2']
            },${second})`,
          );
          await db.execute(
            sql`update roster.workspace_members set status='suspended' where workspace_id=${wid} and subject=${member.identity.subject}`,
          );
          await rejects(() => catalog.listProjects(member, slug), 'forbidden');
          await rejects(
            () => catalog.changeIssueLabels(member, slug, { identifiers: ['PUB-1'], add: [loose] }),
            'forbidden',
          );
        },
      );
    } finally {
      // This suite owns only random workspaces inside its explicitly isolated database.
      for (const id of [wid, otherWid].filter(Boolean)) {
        await setup.query('update roster.issues set project_id=null where workspace_id=$1', [id]);
        for (
          const table of [
            'issue_labels',
            'initiative_projects',
            'initiatives',
            'project_teams',
            'projects',
            'labels',
            'label_groups',
            'issues',
            'team_members',
            'teams',
            'workspace_members',
          ]
        ) await setup.query(`delete from roster.${table} where workspace_id=$1`, [id]);
        await setup.query('delete from roster.workspaces where id=$1', [id]);
      }
      for (const p of people) {
        await setup.query('delete from roster.users where subject=$1', [p.identity.subject]);
      }
      await runtime.pool.end();
      await setup.end();
    }
  },
});
