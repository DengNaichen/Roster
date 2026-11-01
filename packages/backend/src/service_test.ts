import { Pool } from 'npm:pg@8.23.1';
import { createDatabase } from './db/client.ts';
import { createService } from './service.ts';
import { AppError, type RequestContext } from '../../contracts/mod.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof AppError, `Expected AppError, received ${error}`);
    assert(error.code === code, `Expected ${code}, received ${error.code}: ${error.message}`);
    return;
  }
  throw new Error(`Expected ${code} rejection`);
}
const url = Deno.env.get('ROSTER_TEST_DATABASE_URL');
Deno.test({
  name: 'Postgres service: permissions, transactions, invitations, numbering, audit and paging',
  ignore: !url,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    assert(url);
    assert(new URL(url).pathname.endsWith('_test'), 'Tests require an isolated *_test database');
    const setup = new Pool({ connectionString: url });
    const runtimeRole = 'roster_test_runtime';
    const people: RequestContext[] = Array.from(
      { length: 4 },
      (_, i) => ({
        identity: { subject: crypto.randomUUID(), name: `Person ${i}`, email: `${i}@example.test` },
      }),
    );
    const [owner, member, other, inviteRacer] = people;
    const slugs = [`t-${crypto.randomUUID()}`, `t-${crypto.randomUUID()}`];
    let runtime: ReturnType<typeof createDatabase> | undefined;
    try {
      await setup.query(
        `do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$`,
      );
      const exists = await setup.query("select to_regclass('roster.workspaces') as name");
      if (!exists.rows[0].name) {
        await setup.query(
          await Deno.readTextFile(
            new URL('../../../supabase/migrations/20261101000000_initial.sql', import.meta.url),
          ),
        );
      }
      await setup.query(
        `do $$ begin if not exists(select 1 from pg_roles where rolname='${runtimeRole}') then create role ${runtimeRole} login nosuperuser nocreatedb nocreaterole nobypassrls; end if; end $$`,
      );
      await setup.query(`grant roster_app to ${runtimeRole}`);
      const runtimeUrl = new URL(url);
      runtimeUrl.username = runtimeRole;
      runtime = createDatabase(runtimeUrl.toString());
      const role = await runtime.pool.query(
        'select current_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user',
      );
      assert(
        role.rows[0].current_user === runtimeRole && !role.rows[0].rolsuper &&
          !role.rows[0].rolbypassrls,
        'Tests must use restricted runtime role',
      );
      const s = createService(runtime.db);
      await rejects(
        () => s.listWorkspaces({ identity: { subject: '', name: '', email: '' } }),
        'unauthenticated',
      );
      const w = await s.createWorkspace(owner, { slug: slugs[0], name: 'Test workspace' });
      assert(w.role === 'admin');
      await rejects(
        () => s.createWorkspace(owner, { slug: slugs[0], name: 'Duplicate' }),
        'conflict',
      );
      await rejects(
        () => s.createWorkspace(owner, { slug: slugs[1], name: 'Bad', actor: 'spoof' } as never),
        'invalid_input',
      );
      await rejects(
        () =>
          s.updateMember(owner, w.slug, {
            subject: owner.identity.subject,
            role: 'member',
            status: 'active',
          }),
        'conflict',
      );
      const oldInvite = await s.resetInvite(owner, w.slug);
      await s.joinWorkspace(member, oldInvite);
      const newInvite = await s.resetInvite(owner, w.slug);
      await rejects(() => s.joinWorkspace(other, oldInvite), 'not_found');
      await s.joinWorkspace(other, newInvite);
      await rejects(() => s.resetInvite(member, w.slug), 'forbidden');
      await s.updateMember(owner, w.slug, {
        subject: other.identity.subject,
        role: 'admin',
        status: 'active',
      });
      await s.createWorkspace(other, { slug: slugs[1], name: 'Other workspace' });
      await s.createTeam(owner, w.slug, { key: 'AA', name: 'Public' });
      await s.createTeam(owner, w.slug, { key: 'PR', name: 'Private', private: true });
      assert((await s.listTeams(member, w.slug)).length === 1);
      const directory = await s.teamDirectory(other, w.slug);
      assert(
        directory.find((t) => t.key === 'PR')?.next_number === null,
        'Private team numbers must be hidden',
      );
      await rejects(
        () => s.createIssue(member, w.slug, { team: 'PR', title: 'Hidden' }),
        'not_found',
      );
      const hidden = await s.createIssue(owner, w.slug, { team: 'PR', title: 'Private issue' });
      const unchangedPrivate = await s.updateTeam(other, w.slug, 'PR', { private: true });
      assert(
        !unchangedPrivate.joined && unchangedPrivate.next_number === null,
        'Resaving private visibility must not claim membership or reveal numbering',
      );
      await rejects(() => s.getIssue(other, w.slug, hidden.identifier), 'not_found');
      await rejects(() => s.getIssue(member, w.slug, hidden.identifier), 'not_found');
      assert(!(await s.listIssues(member, w.slug)).items.length);
      await rejects(() => s.joinTeam(other, w.slug, 'PR', {}), 'invalid_input');
      await s.joinTeam(other, w.slug, 'PR', { confirm_private: true });
      assert((await s.getIssue(other, w.slug, hidden.identifier)).title === 'Private issue');
      await rejects(() => s.joinTeam(owner, w.slug, 'PR', { leave: true }), 'conflict');
      await rejects(
        () =>
          s.updateMember(other, w.slug, {
            subject: owner.identity.subject,
            role: 'admin',
            status: 'suspended',
          }),
        'conflict',
      );
      await rejects(
        () =>
          s.createIssue(owner, w.slug, {
            team: 'AA',
            title: 'Bad assignee',
            assignee: crypto.randomUUID(),
          }),
        'invalid_input',
      );
      const issues = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          s.createIssue(member, w.slug, {
            team: 'AA',
            title: `Issue ${i}`,
            assignee: member.identity.subject,
          })),
      );
      assert(
        new Set(issues.map((i) => i.identifier)).size === 12,
        'Concurrent issue identifiers must be unique',
      );
      assert(
        issues.some((i) => i.identifier === 'AA-1') && issues.some((i) => i.identifier === 'AA-12'),
        'Failed creation must not consume numbers',
      );
      await rejects(() => s.getIssue(other, slugs[1], issues[0].identifier), 'not_found');
      const edited = await s.updateIssue(member, w.slug, issues[0].identifier, {
        status: 'in_progress',
        type: 'bug',
        priority: 2,
        assignee: null,
      });
      assert(edited.status === 'in_progress' && edited.assignee === null && edited.type === 'bug');
      const detail = await s.getIssue(owner, w.slug, edited.identifier);
      assert(
        detail.audit.length === 2 &&
          detail.audit.every((a) => a.actor_subject === member.identity.subject),
      );
      assert(detail.audit[1].kind === 'issue.updated');
      const first = await s.listIssues(member, w.slug, { limit: 5 });
      assert(first.items.length === 5 && first.next_cursor);
      const second = await s.listIssues(member, w.slug, { limit: 5, cursor: first.next_cursor });
      const both = [...first.items, ...second.items];
      assert(
        both.every((issue, i) => i === 0 || both[i - 1].created_at >= issue.created_at),
        'Issue pages must use descending creation time',
      );
      await rejects(() => s.listIssues(member, w.slug, { cursor: hidden.id }), 'invalid_input');
      await rejects(
        () => s.listIssues(member, w.slug, { cursor: crypto.randomUUID() }),
        'invalid_input',
      );
      assert(
        !second.items.some((i) => first.items.some((j) => i.id === j.id)),
        'Pages must not overlap',
      );
      await s.updateMember(owner, w.slug, {
        subject: member.identity.subject,
        role: 'member',
        status: 'suspended',
      });
      await rejects(() => s.getIssue(member, w.slug, edited.identifier), 'forbidden');
      await rejects(() => s.joinWorkspace(member, newInvite), 'forbidden');
      assert(!(await s.listWorkspaces(member)).length);
      const locker = await setup.connect();
      let racingJoin: Promise<unknown> | undefined;
      try {
        await locker.query('begin');
        await locker.query('select id from roster.workspaces where id=$1 for update', [w.id]);
        racingJoin = s.joinWorkspace(inviteRacer, newInvite);
        // Observe the request blocked on our workspace lock before rotating its token.
        let blocked = false;
        for (let i = 0; i < 100 && !blocked; i++) {
          const activity = await setup.query(
            "select 1 from pg_stat_activity where usename=$1 and wait_event_type='Lock' and query like '%workspace_invites%'",
            [runtimeRole],
          );
          blocked = activity.rows.length > 0;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert(blocked, 'Invitation request must reach the locked transaction');
        await locker.query(
          "update roster.workspace_invites set digest='rotated-by-concurrency-test' where workspace_id=$1",
          [w.id],
        );
        await locker.query('commit');
        await rejects(() => racingJoin!, 'not_found');
        assert(
          !(await s.listWorkspaces(inviteRacer)).length,
          'Reset invitation must not grant membership after waiting for a lock',
        );
      } finally {
        await locker.query('rollback');
        locker.release();
        await racingJoin?.catch(() => {});
      }
      const demotions = await Promise.allSettled([
        s.updateMember(owner, w.slug, {
          subject: owner.identity.subject,
          role: 'member',
          status: 'active',
        }),
        s.updateMember(other, w.slug, {
          subject: other.identity.subject,
          role: 'member',
          status: 'active',
        }),
      ]);
      assert(
        demotions.filter((result) => result.status === 'fulfilled').length === 1,
        'Concurrent administrator demotions must preserve one administrator',
      );
      const admins = await runtime.pool.query(
        "select count(*)::int as n from roster.workspace_members where workspace_id=$1 and role='admin' and status='active'",
        [w.id],
      );
      assert(admins.rows[0].n === 1);
      const audits = await runtime.pool.query(
        'select count(*)::int as n from roster.audit_events where workspace_id=$1',
        [w.id],
      );
      assert(audits.rows[0].n >= 20);
      const denied = await setup.query(
        "select has_schema_privilege('anon','roster','USAGE') as schema,has_table_privilege('authenticated','roster.issues','SELECT') as table",
      );
      assert(
        !denied.rows[0].schema && !denied.rows[0].table,
        'Browser roles must not access service tables',
      );
    } finally {
      await runtime?.pool.end();
      for (const slug of slugs) {
        const ws = await setup.query('select id from roster.workspaces where slug=$1', [slug]);
        if (ws.rows.length) {
          const id = ws.rows[0].id;
          for (
            const table of [
              'audit_events',
              'issues',
              'team_members',
              'teams',
              'workspace_invites',
              'workspace_members',
              'workspaces',
            ]
          ) {
            await setup.query(
              `delete from roster.${table} where ${
                table === 'workspaces' ? 'id' : 'workspace_id'
              }=$1`,
              [id],
            );
          }
        }
      }
      await setup.query('delete from roster.users where subject=any($1::text[])', [
        people.map((p) => p.identity.subject),
      ]);
      await setup.end();
    }
  },
});
