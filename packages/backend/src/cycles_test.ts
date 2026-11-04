import { Pool } from 'npm:pg@8.23.1';
import { AppError, type RequestContext } from '../../contracts/mod.ts';
import { advanceAllCycles, cycleBoundary } from './modules/cycles/index.ts';
import { createDatabase } from './platform/database/client.ts';
import { createUnitOfWork } from './platform/database/session.ts';
import { createService } from './service.ts';
import { cleanupWorkspace, prepareTestDatabase } from './test_support.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof AppError, `${e}`);
    assert(e.code === code, `${e.code}: ${e.message}, expected ${code}`);
    return;
  }
  throw new Error('Expected ' + code);
}
Deno.test('Cycle boundaries use local calendar weeks across both DST transitions', () => {
  const spring = cycleBoundary('2026-03-02', 'America/Los_Angeles', 1);
  assert(
    spring.starts_at === '2026-03-02T08:00:00.000Z' &&
      spring.ends_at === '2026-03-09T07:00:00.000Z',
  );
  const fall = cycleBoundary('2026-10-26', 'America/Los_Angeles', 1);
  assert(
    fall.starts_at === '2026-10-26T07:00:00.000Z' && fall.ends_at === '2026-11-02T08:00:00.000Z',
  );
});
const url = Deno.env.get('ROSTER_TEST_DATABASE_URL');
Deno.test({
  name:
    'Cycles and issue extensions: snapshots, missed intervals, permissions, reconfiguration and parent/catalog references',
  ignore: !url,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    assert(url && new URL(url).pathname.endsWith('_test'));
    const admin = new Pool({ connectionString: url });
    await prepareTestDatabase(admin);
    const u = new URL(url);
    u.username = 'roster_test_runtime';
    const runtime = createDatabase(u.toString());
    const people: RequestContext[] = Array.from(
      { length: 3 },
      (_, i) => ({
        identity: { subject: crypto.randomUUID(), name: 'Cycle ' + i, email: i + '@example.test' },
      }),
    );
    const [owner, member, outsider] = people;
    let clock = new Date('2026-03-02T12:00:00Z');
    const s = createService(runtime.db, { now: () => clock });
    let workspaceId: string | undefined, otherId: string | undefined;
    try {
      const w = await s.createWorkspace(owner, {
        slug: 'c-' + crypto.randomUUID(),
        name: 'Cycle fixture',
      });
      workspaceId = w.id;
      const other = await s.createWorkspace(outsider, {
        slug: 'c-' + crypto.randomUUID(),
        name: 'Other fixture',
      });
      otherId = other.id;
      await s.joinWorkspace(member, await s.resetInvite(owner, w.slug));
      await s.createTeam(owner, w.slug, { key: 'AA', name: 'Main' });
      await s.createTeam(owner, w.slug, { key: 'BB', name: 'Other' });
      await s.createTeam(owner, w.slug, { key: 'PR', name: 'Private', private: true });
      const cfg = {
        enabled: true,
        timezone: 'America/Los_Angeles',
        start_date: '2026-03-02',
        duration_weeks: 1,
        upcoming_count: 2,
      };
      await rejects(() => s.configureCycles(member, w.slug, 'AA', cfg), 'forbidden');
      await rejects(
        () => s.configureCycles(owner, w.slug, 'AA', { ...cfg, timezone: 'Not/AZone' }),
        'invalid_input',
      );
      await rejects(
        () => s.configureCycles(owner, w.slug, 'AA', { ...cfg, start_date: '2026-02-30' }),
        'invalid_input',
      );
      await rejects(
        () => s.configureCycles(owner, w.slug, 'AA', { ...cfg, duration_weeks: 9 }),
        'invalid_input',
      );
      await rejects(
        () => s.configureCycles(owner, w.slug, 'AA', { ...cfg, start_date: '2026-03-01' }),
        'invalid_input',
      );
      let page = await s.configureCycles(owner, w.slug, 'AA', cfg);
      assert(
        page.cycles.length === 3 && page.cycles.filter((c) => c.state === 'current').length === 1,
      );
      const first = page.cycles.find((c) => c.number === 1)!;
      assert(first.ends_at === '2026-03-09T07:00:00.000Z');
      await rejects(
        () => s.configureCycles(owner, w.slug, 'AA', { ...cfg, duration_weeks: 2 }),
        'conflict',
      );
      const privatePage = await s.configureCycles(owner, w.slug, 'PR', cfg);
      await rejects(() => s.getCycle(member, w.slug, privatePage.cycles[0].id), 'not_found');
      await rejects(() => s.listCycles(member, w.slug, 'PR'), 'not_found');
      await rejects(() => s.getCycle(outsider, other.slug, first.id), 'not_found');
      await rejects(
        () =>
          s.createIssue(owner, w.slug, {
            team: 'BB',
            title: 'Cross team cycle',
            cycle_id: first.id,
          }),
        'not_found',
      );
      const issueStatuses = [
        'triage',
        'backlog',
        'todo',
        'agent_ready',
        'in_progress',
        'in_review',
        'done',
        'canceled',
      ] as const;
      const issues = [];
      for (const status of issueStatuses) {
        issues.push(
          await s.createIssue(owner, w.slug, {
            team: 'AA',
            title: status,
            status,
            cycle_id: first.id,
          }),
        );
      }
      assert((await s.listIssues(owner, w.slug, { cycle_id: first.id })).items.length === 8);
      const renamed = await s.updateCycle(member, w.slug, first.id, {
        name: 'Sprint one',
        description: 'Description',
      });
      assert(renamed.name === 'Sprint one');
      clock = new Date('2026-03-23T12:00:00Z');
      await advanceAllCycles(createUnitOfWork(runtime.db), clock);
      page = await s.listCycles(owner, w.slug, 'AA');
      const closed = page.cycles.find((c) => c.id === first.id)!;
      const current = page.cycles.find((c) => c.state === 'current')!;
      assert(
        closed.total === 8 && closed.done === 1 && closed.canceled === 1 &&
          closed.rolled_over === 4,
        'Closed metrics must capture the original membership',
      );
      assert(
        page.cycles.filter((c) => c.state === 'completed').length === 3,
        'Missed intervals must close in order',
      );
      for (const issue of issues) {
        const detail = await s.getIssue(owner, w.slug, issue.identifier);
        assert(
          detail.cycle_id ===
            (['todo', 'agent_ready', 'in_progress', 'in_review'].includes(issue.status)
              ? current.id
              : first.id),
          'Only active workflow states roll',
        );
      }
      const done = issues.find((i) => i.status === 'done')!;
      const reopened = await s.updateIssue(owner, w.slug, done.identifier, { status: 'todo' });
      assert(reopened.cycle_id === first.id, 'Reopening does not silently move closed history');
      assert(
        (await s.getCycle(owner, w.slug, first.id)).done === 1,
        'Closed snapshot must not change after reopening',
      );
      await rejects(
        () =>
          s.createIssue(owner, w.slug, {
            team: 'AA',
            title: 'Closed reference',
            cycle_id: first.id,
          }),
        'conflict',
      );
      const same = await s.updateIssue(owner, w.slug, done.identifier, {
        cycle_id: first.id,
        title: 'Retain closed',
      });
      assert(same.cycle_id === first.id);
      await s.updateIssue(owner, w.slug, done.identifier, { cycle_id: current.id });
      await s.updateIssue(owner, w.slug, done.identifier, { cycle_id: 0 });
      assert((await s.getIssue(owner, w.slug, done.identifier)).cycle_id === null);
      // Project and parent constraints are shared by REST and MCP through core issue methods.
      const project = await s.createProject(owner, w.slug, { name: 'Core project', teams: ['AA'] });
      const parent = await s.createIssue(owner, w.slug, {
        team: 'AA',
        title: 'Parent',
        project_id: project.id,
      });
      const child = await s.createIssue(owner, w.slug, {
        team: 'AA',
        title: 'Child',
        parent: parent.identifier,
        project: 'Core project',
      });
      assert(
        child.parent === parent.identifier && child.project_id === project.id &&
          child.project === 'Core project',
      );
      assert(
        (await s.getIssue(owner, w.slug, parent.identifier)).children.some((i) =>
          i.identifier === child.identifier
        ),
      );
      await rejects(
        () => s.updateIssue(owner, w.slug, parent.identifier, { parent: child.identifier }),
        'invalid_input',
      );
      await rejects(
        () => s.updateIssue(owner, w.slug, child.identifier, { parent: child.id }),
        'invalid_input',
      );
      await rejects(
        () =>
          s.createIssue(owner, w.slug, {
            team: 'BB',
            title: 'Wrong project team',
            project_id: project.id,
          }),
        'invalid_input',
      );
      await s.updateProject(owner, w.slug, { id: project.id, archived: true });
      await s.updateIssue(owner, w.slug, child.identifier, {
        project_id: project.id,
        title: 'Keep archived project',
      });
      await rejects(
        () =>
          s.createIssue(owner, w.slug, {
            team: 'AA',
            title: 'New archived project',
            project_id: project.id,
          }),
        'conflict',
      );
      const secret = await s.createIssue(owner, w.slug, { team: 'PR', title: 'Secret parent' });
      await s.updateIssue(owner, w.slug, child.identifier, { parent: secret.identifier });
      assert(
        !(JSON.stringify((await s.getIssue(member, w.slug, child.identifier)).audit).includes(
          secret.id,
        )),
        'Audit snapshots must not leak private parent IDs',
      );
      assert(
        (await s.getIssue(member, w.slug, child.identifier)).parent === null,
        'Private parents must not leak identifiers',
      );
      await rejects(
        () => s.updateIssue(member, w.slug, child.identifier, { parent: secret.identifier }),
        'not_found',
      );
      await s.updateIssue(owner, w.slug, child.identifier, { parent: '', project_id: 0 });
      const label = await s.createLabel(owner, w.slug, { name: 'Important', color: '#123456' });
      await s.changeIssueLabels(owner, w.slug, {
        identifiers: [child.identifier],
        add: [label.id],
      });
      assert((await s.getIssue(owner, w.slug, child.identifier)).labels[0].id === label.id);
      assert(
        (await s.listIssues(owner, w.slug, { label_ids: [label.id], label_mode: 'all' })).items
          .length === 1,
      );
      assert(
        (await s.listIssues(owner, w.slug, { project_id: project.id })).items.some((i) =>
          i.identifier === parent.identifier
        ),
      );
      // Disabling seals only the started cycle, removes future plans and clears their assignments.
      const future = page.cycles.find((c) => c.state === 'upcoming')!;
      const planned = await s.createIssue(owner, w.slug, {
        team: 'AA',
        title: 'Future plan',
        cycle_id: future.id,
      });
      clock = new Date('2026-03-24T12:00:00Z');
      page = await s.configureCycles(owner, w.slug, 'AA', { ...cfg, enabled: false });
      assert(page.cycles.every((c) => c.completed_at));
      assert((await s.getIssue(owner, w.slug, planned.identifier)).cycle_id === null);
      await rejects(
        () => s.configureCycles(owner, w.slug, 'AA', { ...cfg, start_date: '2026-03-23' }),
        'conflict',
      );
      page = await s.configureCycles(owner, w.slug, 'AA', {
        ...cfg,
        timezone: 'UTC',
        start_date: '2026-03-30',
      });
      assert(
        page.cycles.some((c) => c.timezone === 'America/Los_Angeles') &&
          page.cycles.some((c) => c.timezone === 'UTC'),
        'Schedule changes must preserve historical timezones',
      );
      // A team without a configuration row starts on the default weekly schedule (this Monday, UTC).
      clock = new Date('2026-04-01T12:00:00Z');
      const utc = { ...cfg, timezone: 'UTC' };
      await s.createTeam(owner, w.slug, { key: 'CC', name: 'Default' });
      const auto = await s.listCycles(owner, w.slug, 'CC');
      assert(
        auto.settings.enabled && auto.settings.start_date === '2026-03-30' &&
          auto.settings.duration_weeks === 1 && auto.settings.timezone === 'UTC',
        'New teams default to weekly cycles from this Monday',
      );
      assert(auto.cycles.length === 3, 'The current cycle and two upcoming ones are generated');
      assert(
        auto.cycles.find((c) => c.state === 'current')?.starts_at === '2026-03-30T00:00:00.000Z',
      );
      // An explicit opt-out is kept and never re-enabled by reading.
      await s.configureCycles(owner, w.slug, 'CC', {
        ...utc,
        start_date: '2026-03-30',
        enabled: false,
      });
      assert(!(await s.listCycles(owner, w.slug, 'CC')).settings.enabled);
      // Schedules begin on a Monday, and this week's Monday is allowed mid-week.
      await s.createTeam(owner, w.slug, { key: 'DD', name: 'Midweek' });
      await rejects(
        () => s.configureCycles(owner, w.slug, 'DD', { ...utc, start_date: '2026-04-01' }),
        'invalid_input',
      );
      await rejects(
        () => s.configureCycles(owner, w.slug, 'DD', { ...utc, start_date: '2026-03-23' }),
        'invalid_input',
      );
      const midweek = await s.configureCycles(owner, w.slug, 'DD', {
        ...utc,
        start_date: '2026-03-30',
      });
      assert(midweek.cycles.some((c) => c.state === 'current'));
    } finally {
      await runtime.pool.end();
      if (workspaceId) await cleanupWorkspace(admin, workspaceId);
      if (otherId) await cleanupWorkspace(admin, otherId);
      await admin.query('delete from roster.users where subject=any($1::text[])', [
        people.map((p) => p.identity.subject),
      ]);
      await admin.end();
    }
  },
});
