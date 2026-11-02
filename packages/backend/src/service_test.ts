import { Pool } from 'npm:pg@8.23.1';
import { AppError, type RequestContext } from '../../contracts/mod.ts';
import { createDatabase } from './platform/database/client.ts';
import { createService } from './service.ts';
import { cleanupWorkspace, prepareTestDatabase } from './test_support.ts';
import { createHttpApp } from './transport/http/app.ts';

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
      await prepareTestDatabase(setup);
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
      assert((await s.listAssignees(member, w.slug, 'AA')).length === 3);
      await rejects(() => s.listAssignees(member, w.slug, 'PR'), 'not_found');
      assert((await s.listAssignees(owner, w.slug, 'PR')).length === 1);
      await rejects(() => s.joinTeam(other, w.slug, 'PR', {}), 'invalid_input');
      await s.joinTeam(other, w.slug, 'PR', { confirm_private: true });
      assert((await s.getIssue(other, w.slug, hidden.identifier)).title === 'Private issue');
      const admins = await s.listTeamMembers(other, w.slug, 'PR');
      assert(
        admins.every((m) => m.role === 'owner' && m.workspace_admin),
        'Workspace admins display owner role even when their stored team role is member',
      );
      const left = await s.joinTeam(owner, w.slug, 'PR', { leave: true });
      assert(
        !left.joined && !left.accessible && left.can_manage,
        'The final stored owner may leave; workspace admin retains management',
      );
      await rejects(() => s.getIssue(owner, w.slug, hidden.identifier), 'not_found');
      await s.joinTeam(owner, w.slug, 'PR', { confirm_private: true });
      await s.updateMember(other, w.slug, {
        subject: owner.identity.subject,
        role: 'admin',
        status: 'suspended',
      });
      await rejects(() => s.getIssue(owner, w.slug, hidden.identifier), 'forbidden');
      await s.updateMember(other, w.slug, {
        subject: owner.identity.subject,
        role: 'admin',
        status: 'active',
      });
      const renamed = await s.updateTeam(member, w.slug, 'AA', {
        name: 'Renamed public team',
        emoji: '😀',
      });
      assert(
        renamed.name === 'Renamed public team' && renamed.emoji === '😀',
        'Visible public team metadata may be edited by any active workspace member',
      );
      await rejects(() => s.updateTeam(member, w.slug, 'AA', { private: true }), 'forbidden');
      await s.createTeam(member, w.slug, { key: 'MO', name: 'Ownerless allowed' });
      await s.changeTeamMember(other, w.slug, 'MO', {
        subject: member.identity.subject,
        role: 'member',
      });
      assert(
        (await s.listTeamMembers(owner, w.slug, 'MO'))[0].role === 'member',
        'Last owner may be demoted',
      );
      await s.changeTeamMember(other, w.slug, 'MO', {
        subject: member.identity.subject,
        role: 'owner',
      });
      await s.changeTeamMember(other, w.slug, 'MO', {
        subject: member.identity.subject,
        remove: true,
      });
      assert(
        !(await s.listTeamMembers(owner, w.slug, 'MO')).length,
        'Teams may have no owners or members',
      );
      await s.changeTeamMember(other, w.slug, 'MO', { subject: crypto.randomUUID(), remove: true });
      await s.createTeam(member, w.slug, { key: 'LV', name: 'Leave allowed' });
      assert(
        !(await s.joinTeam(member, w.slug, 'LV', { leave: true })).joined,
        'Last owner may leave without an administrator action',
      );
      await s.createTeam(member, w.slug, { key: 'SP', name: 'Suspension allowed' });
      await s.updateMember(other, w.slug, {
        subject: member.identity.subject,
        role: 'member',
        status: 'suspended',
      });
      await s.updateMember(other, w.slug, {
        subject: member.identity.subject,
        role: 'member',
        status: 'active',
      });
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
      assert(
        detail.audit.every((event) =>
          [event.before, event.after].every((snapshot) =>
            !snapshot || typeof snapshot !== 'object' ||
            !['parent_id', 'project_id', 'cycle_id', 'workspace_id', 'team_id'].some((key) =>
              key in snapshot
            )
          )
        ),
        'Public audit snapshots do not leak internal or historical reference IDs',
      );
      assert(BigInt(detail.audit[0].id) < BigInt(detail.audit[1].id), 'Audit IDs sort numerically');
      assert(
        (await s.listIssues(member, w.slug, { priority: 2, type: 'bug', assignee: null })).items
          .length === 1,
      );
      assert((await s.listIssues(member, w.slug, { assigned_to_me: true })).items.length === 11);
      await rejects(
        () => s.listIssues(member, w.slug, { assigned_to_me: true, assignee: null }),
        'invalid_input',
      );
      const http = createHttpApp({ service: s, verify: async () => member, allowedOrigins: [] });
      const request = async (path: string, method = 'GET', body?: unknown) =>
        await http.request('https://local/api/w/' + w.slug + path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      const createdResponse = await request('/issues', 'POST', {
        team: 'AA',
        title: 'Original frontend HTTP',
        assignee: '',
        type: '',
        project_id: 0,
        cycle_id: 0,
      });
      assert(createdResponse.status === 201, await createdResponse.clone().text());
      const createdHTTP = await createdResponse.json();
      const statusResponse = await request(
        '/issues/' + createdHTTP.identifier + '/status',
        'PATCH',
        { status: 'done' },
      );
      assert(statusResponse.status === 200 && (await statusResponse.json()).status === 'done');
      const httpList = await (await request('/issues?label_mode=any&query=Original')).json();
      assert(
        httpList.issues.length === 1 && httpList.issues[0].identifier === createdHTTP.identifier,
      );
      const httpDetail = await (await request('/issues/' + createdHTTP.identifier)).json();
      assert(httpDetail.audit.length === 2 && Array.isArray(httpDetail.comments));
      assert((await request('/projects')).status === 200);

      const isISO = (value: string) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
        new Date(value).toISOString() === value;
      assert(
        [...issues, edited, detail].every((issue) =>
          isISO(issue.created_at) && isISO(issue.updated_at)
        ),
        'Create, update and detail timestamps must be ISO UTC',
      );
      assert(
        detail.audit.every((event) => isISO(event.created_at)),
        'Audit timestamps must be ISO UTC',
      );
      const first = await s.listIssues(member, w.slug, { limit: 5 });
      assert(first.items.length === 5 && first.next_cursor);
      const second = await s.listIssues(member, w.slug, { limit: 5, cursor: first.next_cursor });
      const both = [...first.items, ...second.items];
      assert(
        both.every((issue) => isISO(issue.created_at) && isISO(issue.updated_at)),
        'List timestamps must be ISO UTC',
      );
      assert(
        both.every((issue, i) => i === 0 || both[i - 1].updated_at >= issue.updated_at),
        'Issue pages must use descending update time',
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
      await rejects(
        () => s.createTeam(owner, w.slug, { key: 'EM', name: 'Bad emoji', emoji: 'hello 😀' }),
        'invalid_input',
      );
      const ready = [];
      for (const priority of [0, 4, 1]) {
        ready.push(
          await s.createIssue(owner, w.slug, {
            team: 'AA',
            title: 'Priority semantics',
            status: 'agent_ready',
            priority,
          }),
        );
      }
      const priorityPage = await s.listIssues(owner, w.slug, {
        status: 'agent_ready',
        query: 'Priority semantics',
        limit: -1,
      });
      assert(
        priorityPage.items.map((i) => i.priority).join(',') === '1,4,0' &&
          priorityPage.next_cursor === null,
        'Agent-ready defaults to priority, with no priority last, and negative limit returns all',
      );
      assert(
        (await s.listIssues(owner, w.slug, { query: 'Priority semantics', limit: 0 })).items
          .length === 3,
        'Zero limit uses the default instead of returning nothing',
      );
      const priorityFirst = await s.listIssues(owner, w.slug, {
        status: 'agent_ready',
        query: 'Priority semantics',
        limit: 1,
      });
      const priorityNext = await s.listIssues(owner, w.slug, {
        status: 'agent_ready',
        query: 'Priority semantics',
        limit: 1,
        cursor: priorityFirst.next_cursor!,
      });
      assert(
        priorityFirst.items[0].priority === 1 && priorityNext.items[0].priority === 4,
        'Priority cursor must use the priority/update/id ordering',
      );
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
      const activeAdmins = await runtime.pool.query(
        "select count(*)::int as n from roster.workspace_members where workspace_id=$1 and role='admin' and status='active'",
        [w.id],
      );
      assert(activeAdmins.rows[0].n === 1);
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
          await cleanupWorkspace(setup, id);
        }
      }
      await setup.query('delete from roster.users where subject=any($1::text[])', [
        people.map((p) => p.identity.subject),
      ]);
      await setup.end();
    }
  },
});
