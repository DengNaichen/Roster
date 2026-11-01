import { createHttpApp } from './http.ts';
import type { Issue, Service, Team } from '../../../contracts/mod.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const identity = {
  subject: 'f06ddfcf-545d-4d29-977e-6151bf65b465',
  name: 'Member',
  email: 'member@example.test',
};
const issue: Issue = {
  id: 'f06ddfcf-545d-4d29-977e-6151bf65b466',
  identifier: 'AL-1',
  team: 'AL',
  title: 'Task',
  description: 'Body',
  status: 'triage',
  type: null,
  priority: 0,
  assignee: null,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};
const team: Team = {
  id: issue.id,
  key: 'AL',
  name: 'Team',
  emoji: '',
  private: false,
  joined: true,
  accessible: true,
  can_manage: true,
  next_number: 2,
};
Deno.test('Original frontend REST contracts use real issue service and explicit unsupported capabilities', async () => {
  const calls: { method: string; input: unknown }[] = [];
  const service = {
    listTeams: async () => [team],
    teamDirectory: async () => [team],
    listMembers: async () => [{ ...identity, role: 'admin', status: 'active' }],
    listTeamMembers: async () => [{ ...identity, role: 'owner', status: 'active' }],
    listAssignees: async () => [identity],
    listIssues: async (_c: unknown, _w: unknown, input: unknown) => {
      calls.push({ method: 'list', input });
      return { items: [issue], next_cursor: null };
    },
    createIssue: async (_c: unknown, _w: unknown, input: unknown) => {
      calls.push({ method: 'create', input });
      return issue;
    },
    updateIssue: async (_c: unknown, _w: unknown, _id: unknown, input: unknown) => {
      calls.push({ method: 'update', input });
      return { ...issue, ...input as object };
    },
    getIssue: async () => ({ ...issue, audit: [] }),
    updateWorkspace: async () => ({
      id: issue.id,
      slug: 'default',
      name: 'Renamed',
      role: 'admin',
    }),
  } as unknown as Service;
  const app = createHttpApp({ service, verify: async () => ({ identity }), allowedOrigins: [] });
  const req = async (path: string, method = 'GET', body?: unknown) =>
    await app.request(`https://app/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const caps = await (await req('/w/default/capabilities')).json();
  assert(caps.capabilities.issues && !caps.capabilities.comments && !caps.capabilities.labels);
  const list =
    await (await req('/w/default/issues?query=&label_mode=any&priority=2&assigned_to_me=true'))
      .json();
  assert(list.issues[0].identifier === 'AL-1' && list.items[0].identifier === 'AL-1');
  assert(!('labels' in list.issues[0]));
  assert(
    JSON.stringify(calls[0].input) ===
      JSON.stringify({ priority: 2, assigned_to_me: true, query: '' }),
  );
  assert(
    (await req('/w/default/issues', 'POST', {
      team: 'AL',
      title: 'Task',
      type: '',
      assignee: '',
      project_id: 0,
      cycle_id: 0,
      parent: '',
    })).status === 201,
  );
  assert((calls[1].input as { assignee: unknown }).assignee === null);
  assert((await req('/w/default/issues/AL-1/status', 'PATCH', { status: 'done' })).status === 200);
  assert((calls[2].input as { status: unknown }).status === 'done');
  const detail = await (await req('/w/default/issues/AL-1')).json();
  assert(
    !('comments' in detail) && !('delegations' in detail) && Array.isArray(detail.assignments),
  );
  const teams = await (await req('/w/default/teams')).json();
  assert(teams.teams[0].membership_enabled);
  const members = await (await req('/w/default/teams/AL/members')).json();
  assert(members.members[0].workspace_admin);
  assert(
    (await (await req('/w/default/teams/AL/assignees')).json()).assignees[0].subject ===
      identity.subject,
  );
  assert((await req('/workspaces/default', 'PATCH', { name: 'Renamed' })).status === 200);
  for (
    const [path, method, body] of [
      ['/w/default/projects', 'GET', undefined],
      ['/w/default/issues/AL-1/comments', 'POST', { body: 'Comment' }],
      ['/w/default/issues?label_mode=all', 'GET', undefined],
      ['/w/default/issues', 'POST', { team: 'AL', title: 'Task', project_id: 3 }],
    ] as const
  ) {
    const response = await req(path, method, body);
    assert(response.status === 501, `${path} must not pretend to be migrated`);
    const error = await response.json();
    assert(error.error.code === 'not_implemented');
  }
  assert((await req('/w/default/issues?actor=spoof')).status === 400);
});
