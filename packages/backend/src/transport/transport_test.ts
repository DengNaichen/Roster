import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'npm:jose@6.1.3';
import { AppError } from '../../../contracts/mod.ts';
import type { Service } from '../application/mod.ts';
import { createIdentityVerifier } from '../platform/auth/jwt.ts';
import { createHttpApp } from './http.ts';
import { createMcpFetch } from './mcp.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const issuer = 'https://project.supabase.co/auth/v1';
const subject = 'f06ddfcf-545d-4d29-977e-6151bf65b465';
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwk = await exportJWK(publicKey);
jwk.kid = 'test';
jwk.alg = 'ES256';
const verify = createIdentityVerifier({
  issuer,
  audience: 'authenticated',
  jwks: createLocalJWKSet({ keys: [jwk] }),
});
async function token(overrides: Record<string, unknown> = {}) {
  return await new SignJWT({ role: 'authenticated', email: 'member@example.com', ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' }).setIssuer(issuer).setAudience(
      'authenticated',
    ).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
}
const request = (url: string, bearer?: string, init: RequestInit = {}) =>
  new Request(url, {
    ...init,
    headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...init.headers },
  });
Deno.test('JWT validates issuer, audience, expiry, role and requires signed user credentials', async () => {
  assert((await verify(request('https://app/api', await token()))).identity.subject === subject);
  for (
    const jwt of [
      undefined,
      'sb_secret_fake',
      await token({ role: 'service_role' }),
      await token({ is_anonymous: true }),
    ]
  ) {
    try {
      await verify(request('https://app/api', jwt));
      throw new Error('Accepted invalid token');
    } catch (error) {
      assert(error instanceof AppError && error.code === 'unauthenticated');
    }
  }
  for (const change of ['issuer', 'audience', 'expiry', 'signature']) {
    const other = await generateKeyPair('ES256');
    const invalid = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({
      alg: 'ES256',
      kid: 'test',
    }).setSubject(subject).setIssuer(change === 'issuer' ? 'https://wrong' : issuer).setAudience(
      change === 'audience' ? 'wrong' : 'authenticated',
    ).setIssuedAt().setExpirationTime(change === 'expiry' ? '1 second ago' : '5m').sign(
      change === 'signature' ? other.privateKey : privateKey,
    );
    try {
      await verify(request('https://app/api', invalid));
      throw new Error('Accepted invalid token');
    } catch (error) {
      assert(error instanceof AppError);
    }
  }
});
Deno.test('REST and MCP invoke the same service with verified actor and strict input', async () => {
  const calls: unknown[] = [];
  const service = {
    listIssues: async (ctx: unknown, slug: unknown, input: unknown) => {
      calls.push({ ctx, slug, input });
      return { items: [], next_cursor: null };
    },
  } as unknown as Service;
  const bearer = await token();
  const app = createHttpApp({ service, verify, allowedOrigins: ['https://ui.example'] });
  const rest = await app.request(request('https://app/api/w/default/issues?team=AL', bearer));
  assert(rest.status === 200);
  const invalid = await app.request(
    request('https://app/api/w/default/issues?actor=other', bearer),
  );
  assert(invalid.status === 400);
  const mcp = createMcpFetch({
    service,
    verify,
    allowedOrigins: ['https://ui.example'],
    publicUrl: 'https://app',
    authorizationServer: issuer,
  });
  const rpc = await mcp(request('https://app/w/default/mcp', bearer, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_issues', arguments: { team: 'AL' } },
    }),
  }));
  const result = await rpc.text();
  assert(rpc.status === 200, result);
  assert(!result.includes('isError":true'), result);
  assert(result.includes('structuredContent'), result);
  assert(calls.length === 2, JSON.stringify(calls));
  assert(JSON.stringify(calls[0]) === JSON.stringify(calls[1]), 'REST/MCP service context differs');
});
Deno.test('MCP discovery is public, unauthorized responses advertise it, CORS is allowlisted', async () => {
  const fetch = createMcpFetch({
    service: {} as Service,
    verify,
    allowedOrigins: ['https://ui.example'],
    publicUrl: 'https://app/functions/v1/mcp',
    authorizationServer: issuer,
  });
  const metadata = await fetch(
    new Request('https://internal/.well-known/oauth-protected-resource/w/default/mcp'),
  );
  assert(metadata.status === 200);
  const document = await metadata.json();
  assert(document.resource === 'https://app/functions/v1/mcp/w/default/mcp');
  const unauthorized = await fetch(new Request('https://internal/w/default/mcp'));
  assert(unauthorized.status === 401);
  assert(
    unauthorized.headers.get('WWW-Authenticate')?.includes(
      '/.well-known/oauth-protected-resource/w/default/mcp',
    ),
  );
  const denied = await fetch(
    new Request('https://internal/w/default/mcp', { headers: { Origin: 'https://evil.example' } }),
  );
  assert(denied.status === 403);
  assert(!denied.headers.has('Access-Control-Allow-Origin'));
  const preflight = await fetch(
    new Request('https://internal/w/default/mcp', {
      method: 'OPTIONS',
      headers: { Origin: 'https://ui.example' },
    }),
  );
  assert(preflight.status === 204);
  assert(preflight.headers.get('Access-Control-Allow-Origin') === 'https://ui.example');
});

Deno.test('MCP tool errors hide internal exceptions and advertise structured output', async () => {
  const service = {
    listIssues: async () => {
      throw new Error('postgres password=secret');
    },
  } as unknown as Service;
  const fetch = createMcpFetch({
    service,
    verify,
    allowedOrigins: [],
    publicUrl: 'https://app',
    authorizationServer: issuer,
  });
  const bearer = await token();
  const call = async (method: string, params: unknown) =>
    await fetch(
      request('https://app/w/default/mcp', bearer, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    );
  const tools = await (await call('tools/list', {})).text();
  assert(tools.includes('outputSchema'), tools);
  const failed = await (await call('tools/call', { name: 'list_issues', arguments: {} })).text();
  assert(failed.includes('Internal server error'), failed);
  assert(!failed.includes('password'), failed);
});

// Original Go MCP production tool names, excluding tests and server metadata.
export const originalMcpTools = [
  'list_specs',
  'get_spec',
  'create_spec',
  'update_spec',
  'list_spec_revisions',
  'get_spec_revision',
  'list_issues',
  'get_issue',
  'create_issue',
  'update_issue',
  'add_comment',
  'add_work_log',
  'list_work_logs',
  'get_work_log',
  'add_relation',
  'remove_relation',
  'add_link',
  'list_teams',
  'create_team',
  'update_team',
  'list_team_directory',
  'join_team',
  'list_team_members',
  'change_team_member',
  'list_assignees',
  'delegate_issue',
  'list_projects',
  'get_project',
  'create_project',
  'update_project',
  'list_initiatives',
  'get_initiative',
  'create_initiative',
  'update_initiative',
  'list_labels',
  'list_label_groups',
  'save_label_group',
  'create_label',
  'update_label',
  'change_issue_labels',
  'merge_labels',
  'list_cycles',
  'configure_cycles',
  'get_cycle',
  'update_cycle',
];
Deno.test('All original MCP tools are genuinely registered with input and output contracts', async () => {
  assert(
    originalMcpTools.length === 45,
    'The migrated Go tool inventory must contain all 45 production tools',
  );
  const fetch = createMcpFetch({
    service: {} as Service,
    verify: async () => ({ identity: { subject, name: 'Member', email: 'member@example.test' } }),
    allowedOrigins: [],
    publicUrl: 'https://app',
    authorizationServer: issuer,
  });
  const response = await fetch(
    new Request('https://app/w/default/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
  const text = await response.text();
  const jsonLine = text.split('\n').find((line) => line.startsWith('data: '));
  const result = JSON.parse(jsonLine ? jsonLine.slice(6) : text);
  const tools = result.result.tools as {
    name: string;
    inputSchema: unknown;
    outputSchema: unknown;
  }[];
  for (const name of originalMcpTools) {
    const tool = tools.find((t) => t.name === name);
    assert(tool, `Missing migrated tool: ${name}`);
    assert(tool.inputSchema && tool.outputSchema, `Missing contracts for ${name}`);
  }
});
Deno.test('MCP get_issue validates real bigint audit IDs without treating them as UUIDs', async () => {
  const service = {
    getIssue: async () => ({
      id: 'f06ddfcf-545d-4d29-977e-6151bf65b466',
      identifier: 'AL-1',
      team: 'AL',
      title: 'Issue',
      description: 'Body',
      status: 'triage',
      type: null,
      priority: 0,
      assignee: null,
      created_at: '2026-11-02T00:00:00Z',
      updated_at: '2026-11-02T00:00:00Z',
      audit: [{
        id: '123456789012345',
        kind: 'issue.created',
        actor_subject: subject,
        before: null,
        after: { title: 'Issue' },
        created_at: '2026-11-02T00:00:00Z',
      }],
    }),
  } as unknown as Service;
  const fetch = createMcpFetch({
    service,
    verify: async () => ({ identity: { subject, name: 'Member', email: 'member@example.test' } }),
    allowedOrigins: [],
    publicUrl: 'https://app',
    authorizationServer: issuer,
  });
  const response = await fetch(
    new Request('https://app/w/default/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_issue', arguments: { identifier: 'AL-1' } },
      }),
    }),
  );
  const text = await response.text();
  assert(response.status === 200 && !text.includes('isError":true'), text);
  assert(text.includes('123456789012345'), text);
});
