import {
  AppError,
  type Member,
  type RequestContext,
  type Team,
} from '../../../../contracts/mod.ts';
import type { Service } from '../../application/mod.ts';
import { createMcpFetch } from './server.ts';
import {
  AmbiguousReference,
  resolveMcpReferences,
  resolveTeam,
  resolveUser,
} from './references.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const person = 'f06ddfcf-545d-4d29-977e-6151bf65b465';
const ctx: RequestContext = {
  identity: { subject: person, name: 'Alex', email: 'alex@example.test' },
};
const teams: Team[] = [
  {
    id: crypto.randomUUID(),
    key: 'CORE',
    name: 'Core Platform',
    emoji: '',
    private: false,
    joined: true,
    accessible: true,
    can_manage: true,
    next_number: 1,
  },
  {
    id: crypto.randomUUID(),
    key: 'APP',
    name: 'Application',
    emoji: '',
    private: false,
    joined: true,
    accessible: true,
    can_manage: true,
    next_number: 1,
  },
];
const people: Member[] = [{ ...ctx.identity, role: 'admin', status: 'active' }, {
  subject: crypto.randomUUID(),
  name: 'Alex Kim',
  email: 'kim@example.test',
  role: 'member',
  status: 'active',
}];
Deno.test('References resolve keys, names, email and me; stable subjects and omitted fields avoid lookups', async () => {
  assert(resolveTeam(' core platform ', teams) === 'CORE');
  assert(resolveTeam('core', teams) === 'CORE');
  assert(resolveTeam(teams[0].id, teams) === 'CORE');
  assert(resolveUser('ALEX@EXAMPLE.TEST', people) === person);
  assert(resolveUser('Alex K', people) === people[1].subject);
  const noDirectory = {} as Service;
  const cleared = await resolveMcpReferences(noDirectory, ctx, 'studio', 'update_issue', {
    identifier: 'CORE-1',
    assignee: '',
  });
  assert(cleared.assignee === null);
  const me = await resolveMcpReferences(noDirectory, ctx, 'studio', 'update_issue', {
    identifier: 'CORE-1',
    assignee: 'me',
  });
  assert(me.assignee === person);
  const unchanged = await resolveMcpReferences(noDirectory, ctx, 'studio', 'update_issue', {
    identifier: 'CORE-1',
  });
  assert(!Object.hasOwn(unchanged, 'assignee'));
  assert(
    (await resolveMcpReferences(noDirectory, ctx, 'studio', 'update_issue', { assignee: person }))
      .assignee === person,
  );
  try {
    resolveTeam('missing', teams);
    throw new Error('Accepted unknown team');
  } catch (e) {
    assert(e instanceof AppError && e.code === 'not_found');
  }
  try {
    resolveUser('  ', people);
    throw new Error('Accepted empty user');
  } catch (e) {
    assert(e instanceof AppError && e.code === 'invalid_input');
  }
});
Deno.test('Ambiguity returns explicit visible candidates and never chooses one', () => {
  try {
    resolveTeam('Application', [teams[1], { ...teams[0], name: 'Application' }]);
    throw new Error('Picked a team');
  } catch (e) {
    assert(e instanceof AmbiguousReference && e.candidates.length === 2);
    assert(e.candidates.every((c) => Boolean(c.key)));
  }
  try {
    resolveUser('Alex', [people[0], { ...people[1], name: 'Alex' }]);
    throw new Error('Picked a person');
  } catch (e) {
    assert(e instanceof AmbiguousReference && e.candidates.length === 2);
    assert(e.candidates.every((c) => Boolean(c.email)));
  }
});
Deno.test('MCP validates natural references, forwards canonical values, and preserves null/omitted update semantics', async () => {
  const calls: Record<string, unknown>[] = [];
  const service = {
    listTeams: async () => teams,
    teamDirectory: async () => teams,
    listMembers: async () => people,
    createIssue: async (_ctx: unknown, _slug: unknown, input: Record<string, unknown>) => {
      calls.push(input);
      return {
        id: crypto.randomUUID(),
        identifier: 'CORE-1',
        team: 'CORE',
        title: 'Task',
        document: { lead: '', sections: [], criteria: [] },
        status: 'todo',
        type: null,
        priority: 0,
        assignee: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },
    listIssues: async (_ctx: unknown, _slug: unknown, input: Record<string, unknown>) => {
      calls.push(input);
      return { issues: [], next_cursor: null };
    },
  } as unknown as Service;
  const fetch = createMcpFetch({
    service,
    verify: async () => ctx,
    publicUrl: 'https://api',
    authorizationServer: 'https://auth',
    allowedOrigins: [],
  });
  const rpc = async (name: string, args: unknown) => {
    const r = await fetch(
      new Request('https://api/w/studio/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      }),
    );
    const text = await r.text();
    const line = text.split('\n').find((l) => l.startsWith('data: '));
    return JSON.parse(line ? line.slice(6) : text);
  };
  const created = await rpc('create_issue', {
    team: 'Core Platform',
    title: 'Task',
    assignee: 'alex@example.test',
  });
  assert(!created.result.isError, JSON.stringify(created));
  assert(calls[0].team === 'CORE' && calls[0].assignee === person);
  await rpc('list_issues', { assignee: 'me', team: 'Application' });
  assert(calls[1].assignee === person && calls[1].team === 'APP');
  await rpc('list_issues', { assignee: null });
  assert(calls[2].assignee === null);
  await rpc('list_issues', {});
  assert(!Object.hasOwn(calls[3], 'assignee'));
  people.push({ ...people[1], subject: crypto.randomUUID(), email: 'other@example.test' });
  try {
    const ambiguous = await rpc('create_issue', {
      team: 'Core Platform',
      title: 'No guess',
      assignee: 'Alex Kim',
    });
    const error = JSON.parse(ambiguous.result.content[0].text).error;
    assert(error.code === 'invalid_input' && error.candidates.length === 2);
    assert(calls.length === 4, 'Ambiguous references must not write');
  } finally {
    people.pop();
  }
  const hidden = await rpc('create_issue', { team: 'Private Secret Team', title: 'No leak' });
  assert(hidden.result.isError && calls.length === 4);
  const removed = await rpc('team_directory', {});
  assert(Boolean(removed.error) || removed.result?.isError);
});
