import type { Service } from '../application/mod.ts';
/** Exercised from the real Postgres Spec suite, never with a stub service. */
import type { RequestContext } from '../../../contracts/mod.ts';
import type {
  Spec,
  SpecContent,
  SpecRevision,
  SpecRevisionSummary,
  SpecSummary,
} from '../../../contracts/spec.ts';
import { createHttpApp } from './http/app.ts';
import { createMcpFetch } from './mcp/server.ts';
function assert(value: unknown, message = 'Spec transport assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const initial: SpecContent = {
  title: 'REST transport spec',
  status: 'draft',
  stories: [{
    id: 'US-1',
    title: 'Read a spec',
    priority: 'P1',
    description: 'A member reads the current spec.',
    why: 'Shared understanding',
    independent_test: 'Open the spec',
    scenarios: [{
      given: 'An active member',
      when: 'Reading the spec',
      then: 'Current content is returned',
    }],
  }],
  edge_cases: [],
  requirements: [{ id: 'FR-001', text: 'Keep immutable history' }],
  entities: [],
  success_criteria: [{ id: 'SC-001', text: 'Prior revisions remain unchanged' }],
  clarifications: [],
};
export async function exerciseSpecTransports(
  service: Service,
  ctx: RequestContext,
  slug: string,
  team: string,
) {
  const app = createHttpApp({ service, verify: async () => ctx, allowedOrigins: [] });
  const rest = async (path: string, method = 'GET', body?: unknown, status = 200) => {
    const response = await app.request(`https://app/api/w/${slug}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    assert(
      response.status === status,
      `${method} ${path}: ${response.status} ${JSON.stringify(data)}`,
    );
    return data;
  };
  const created = await rest('/specs', 'POST', {
    team,
    content: initial,
    message: 'Initial version',
  }, 201) as Spec;
  assert(created.author?.subject === ctx.identity.subject && created.revision === 1);
  const list = await rest(`/specs?team=${team}`) as { specs: SpecSummary[] };
  assert(list.specs.some((spec) => spec.identifier === created.identifier));
  const current = await rest(`/specs/${created.identifier}`) as Spec;
  assert(current.content.title === initial.title);
  const revisedContent = { ...initial, title: 'REST revised spec' };
  const updated = await rest(`/specs/${created.identifier}`, 'PUT', {
    base_revision: 1,
    content: revisedContent,
    message: 'Revised',
  }) as Spec;
  assert(updated.revision === 2 && updated.author?.subject === ctx.identity.subject);
  const history = await rest(`/specs/${created.identifier}/revisions`) as {
    revisions: SpecRevisionSummary[];
  };
  assert(history.revisions.length === 2 && history.revisions[0].number === 2);
  const original = await rest(`/specs/${created.identifier}/revisions/1`) as SpecRevision;
  assert(
    original.content.title === initial.title && original.author?.subject === ctx.identity.subject,
  );
  await rest(`/specs/${created.identifier}`, 'PUT', {
    identifier: created.identifier,
    base_revision: 2,
    content: revisedContent,
  }, 400);
  await rest(`/specs/${created.identifier}`, 'PUT', { base_revision: 1, content: initial }, 409);
  await rest('/specs', 'POST', { team, content: initial, author: { subject: 'forged' } }, 400);
  await rest('/specs?actor=forged', 'GET', undefined, 400);
  await rest('/specs?team=AL&team=SEC', 'GET', undefined, 400);
  await rest(`/specs/${created.identifier}/revisions/1`, 'PUT', { content: revisedContent }, 404);
  const mcp = createMcpFetch({
    service,
    verify: async () => ctx,
    allowedOrigins: [],
    publicUrl: 'https://app',
    authorizationServer: 'https://auth.example/auth/v1',
  });
  const call = async <T>(name: string, input: unknown, expectedError?: string): Promise<T> => {
    const response = await mcp(
      new Request(`https://app/w/${slug}/mcp`, {
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
          params: { name, arguments: input },
        }),
      }),
    );
    const text = await response.text();
    const line = text.split('\n').find((v) => v.startsWith('data: '));
    const document = JSON.parse(line ? line.slice(6) : text);
    assert(response.ok && !document.error, text);
    if (expectedError) {
      assert(document.result.isError, text);
      assert(
        document.result.content.some((item: { text?: string }) =>
          item.text?.includes(`"code":"${expectedError}"`)
        ),
        text,
      );
      return undefined as T;
    }
    assert(!document.result.isError, text);
    return document.result.structuredContent.result as T;
  };
  const issue = await service.createIssue(ctx, slug, {
    team,
    title: 'Spec link transport fixture',
  });
  const linksPath = `/specs/${created.identifier}/issues`;
  await rest(linksPath, 'POST', { issues: [issue.identifier] });
  const linkedRest = await rest(linksPath + '?limit=-1') as { issues: { identifier: string }[] };
  assert(linkedRest.issues.some((item) => item.identifier === issue.identifier));
  await rest(linksPath, 'POST', { issues: [] }, 400);
  await rest(linksPath, 'POST', { identifier: 'SPEC-999', issues: [issue.identifier] }, 400);
  await rest(linksPath + '?spec=SPEC-999', 'GET', undefined, 400);
  await rest(`/issues/${issue.identifier}/specs`);
  const mcpLinked = await call<{ items: { identifier: string }[] }>('list_spec_issues', {
    identifier: created.identifier,
  });
  assert(mcpLinked.items.some((item) => item.identifier === issue.identifier));
  await call('unlink_spec_issue', { identifier: created.identifier, issue: issue.identifier });
  assert((await rest(linksPath) as { issues: unknown[] }).issues.length === 0);
  await call('unlink_spec_issue', { identifier: created.identifier, issue: issue.identifier });
  await call('link_spec_issue', { identifier: created.identifier, issue: issue.identifier });
  await call('link_spec_issue', { identifier: created.identifier, issue: issue.identifier });
  const reverse = await call<SpecSummary[]>('list_issue_specs', { issue: issue.identifier });
  assert(reverse.some((item) => item.identifier === created.identifier));
  await rest(linksPath, 'DELETE', { issues: [issue.identifier] });
  assert((await call<SpecSummary[]>('list_issue_specs', { issue: issue.identifier })).length === 0);
  await call(
    'link_spec_issue',
    { identifier: created.identifier, issue: 'XX-999999' },
    'not_found',
  );
  const mcpContent = { ...initial, title: 'MCP transport spec' };
  const mcpCreated = await call<Spec>('create_spec', {
    team,
    content: mcpContent,
    message: 'MCP initial',
  });
  assert(mcpCreated.revision === 1 && mcpCreated.author?.subject === ctx.identity.subject);
  const mcpList = await call<SpecSummary[]>('list_specs', { team });
  assert(mcpList.some((spec) => spec.identifier === mcpCreated.identifier));
  const mcpCurrent = await call<Spec>('get_spec', { identifier: mcpCreated.identifier });
  assert(mcpCurrent.content.title === mcpContent.title);
  const designRef = { identifier: mcpCreated.identifier };
  const designInput = {
    ...designRef,
    base_revision: 0,
    spec_revision: 1,
    content: { decisions: [{ title: 'Keep links independent' }] },
  };
  type DesignResponse = {
    design: { revision: number; content: { decisions: { title: string }[] } } | null;
  };
  assert((await call<DesignResponse>('get_spec_design', designRef)).design === null);
  assert((await call<DesignResponse>('set_spec_design', designInput)).design?.revision === 1);
  await call('set_spec_design', designInput, 'conflict');
  const update = { ...designInput, base_revision: 1 };
  const winners = await Promise.allSettled([
    call<DesignResponse>('set_spec_design', update),
    call<DesignResponse>('set_spec_design', update),
  ]);
  assert(winners.filter((r) => r.status === 'fulfilled').length === 1);
  assert((await call<DesignResponse>('get_spec_design', designRef)).design?.revision === 2);
  const shared = await rest(`/specs/${mcpCreated.identifier}/design`) as DesignResponse;
  assert(shared.design?.content.decisions[0].title === 'Keep links independent');
  await rest(`/specs/${mcpCreated.identifier}/design`, 'PUT', designInput, 404);
  const mcpUpdated = await call<Spec>('update_spec', {
    identifier: mcpCreated.identifier,
    base_revision: 1,
    content: { ...mcpContent, title: 'MCP revised spec' },
    message: 'MCP revised',
  });
  assert(mcpUpdated.revision === 2);
  const mcpRevisions = await call<SpecRevisionSummary[]>('list_spec_revisions', {
    identifier: mcpCreated.identifier,
  });
  assert(mcpRevisions.length === 2 && mcpRevisions[0].number === 2);
  const old = await call<SpecRevision>('get_spec_revision', {
    identifier: mcpCreated.identifier,
    number: 1,
  });
  assert(old.content.title === mcpContent.title);
  await call('update_spec', {
    identifier: mcpCreated.identifier,
    base_revision: 1,
    content: mcpContent,
  }, 'conflict');
  const unchanged = await call<SpecRevision>('get_spec_revision', {
    identifier: mcpCreated.identifier,
    number: 1,
  });
  assert(
    JSON.stringify(old) === JSON.stringify(unchanged),
    'Conflict must not mutate historical revision',
  );
  const after = await call<Spec>('get_spec', { identifier: mcpCreated.identifier });
  assert(after.revision === 2 && after.content.title === 'MCP revised spec');
}
