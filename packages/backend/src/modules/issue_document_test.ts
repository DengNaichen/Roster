import { isDeepStrictEqual } from 'node:util';
import { Pool } from 'npm:pg@8.23.1';
import {
  type Issue,
  type IssueDetail,
  type IssueDocument,
  issueDocumentText,
  type RequestContext,
} from '../../../contracts/mod.ts';
import { createDatabase } from '../platform/database/client.ts';
import { createService } from '../service.ts';
import { cleanupWorkspace, prepareTestDatabase } from '../test_support.ts';
import { createHttpApp } from '../transport/http/app.ts';
import { createMcpFetch } from '../transport/mcp/server.ts';
import { documentFromDescription } from './issues/index.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const full: IssueDocument = {
  lead: 'Members see blocked work at a glance.',
  sections: [
    {
      title: 'Scope',
      blocks: [
        { type: 'paragraph', text: 'Show a marker on blocked rows in `IssueList`.' },
        {
          type: 'compare',
          left: { title: 'In scope', items: ['List rows'] },
          right: { title: 'Out of scope', items: ['Board cards'] },
        },
      ],
    },
    {
      title: 'States',
      blocks: [
        { type: 'table', columns: ['State', 'Marker'], rows: [['Blocked', 'zebracell']] },
        { type: 'note', title: 'Risk', text: 'Hidden blockers stay hidden.' },
        { type: 'list', ordered: true, items: [{ title: 'Open', text: 'Open the list.' }] },
        { type: 'code', text: 'GET /api/w/x/issues' },
      ],
    },
  ],
  criteria: [
    { id: 'AC-1', title: 'Blocked rows are marked.', detail: 'Open the list.', done: false },
    { id: 'AC-2', title: 'Unblocked rows are plain.', detail: '', done: false },
    { id: 'AC-3', title: 'Markers survive reload.', detail: '', done: true },
  ],
};
const url = Deno.env.get('ROSTER_TEST_DATABASE_URL');
Deno.test({
  name: 'Issue documents over REST and MCP: validation paths, whole replace, search',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assert(url && new URL(url).pathname.endsWith('_test'));
    const admin = new Pool({ connectionString: url });
    let runtime: ReturnType<typeof createDatabase> | undefined;
    const workspaces: string[] = [];
    const actors = new Map<string, RequestContext>();
    const actor = (name: string): RequestContext => {
      const ctx = {
        identity: { subject: crypto.randomUUID(), name, email: name + '@example.test' },
      };
      actors.set(name, ctx);
      return ctx;
    };
    const owner = actor('owner'), member = actor('member'), outsider = actor('outsider');
    try {
      await prepareTestDatabase(admin);
      const runtimeUrl = new URL(url);
      runtimeUrl.username = 'roster_test_runtime';
      runtime = createDatabase(runtimeUrl.toString());
      const service = createService(runtime.db);
      const w = await service.createWorkspace(owner, {
        slug: 'doc-' + crypto.randomUUID(),
        name: 'Documents',
      });
      workspaces.push(w.id);
      const other = await service.createWorkspace(outsider, {
        slug: 'doc-' + crypto.randomUUID(),
        name: 'Other',
      });
      workspaces.push(other.id);
      await service.joinWorkspace(member, await service.resetInvite(owner, w.slug));
      await service.createTeam(owner, w.slug, { key: 'DOC', name: 'Public' });
      await service.createTeam(owner, w.slug, { key: 'SEC', name: 'Private', private: true });

      const verify = async (request: Request) => actors.get(request.headers.get('x-actor')!)!;
      const app = createHttpApp({ service, verify, allowedOrigins: [] });
      const rest = async <T>(
        as: string,
        path: string,
        method = 'GET',
        body?: unknown,
        status = 200,
      ): Promise<T> => {
        const response = await app.request(`https://app/api/w/${w.slug}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', 'x-actor': as },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await response.json();
        assert(
          response.status === status,
          `${method} ${path}: ${response.status} ${JSON.stringify(data)}`,
        );
        return data as T;
      };
      const mcp = createMcpFetch({
        service,
        verify,
        allowedOrigins: [],
        publicUrl: 'https://app',
        authorizationServer: 'https://auth.example/auth/v1',
      });
      const call = async (as: string, name: string, args: unknown) => {
        const response = await mcp(
          new Request(`https://app/w/${w.slug}/mcp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/event-stream',
              'MCP-Protocol-Version': '2025-11-25',
              'x-actor': as,
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name, arguments: args },
            }),
          }),
        );
        const text = await response.text();
        const line = text.split('\n').find((v) => v.startsWith('data: '));
        const document = JSON.parse(line ? line.slice(6) : text);
        assert(response.ok && !document.error, text);
        return document.result as {
          isError?: boolean;
          content: { text: string }[];
          structuredContent?: { result: Issue };
        };
      };
      const mcpOk = async (as: string, name: string, args: unknown) => {
        const result = await call(as, name, args);
        assert(!result.isError, JSON.stringify(result));
        return result.structuredContent!.result;
      };

      const created = await rest<Issue>('owner', '/issues', 'POST', {
        team: 'DOC',
        title: 'Mark blocked rows',
        document: full,
      }, 201);
      assert(isDeepStrictEqual(created.document, full), JSON.stringify(created.document));
      const read = await rest<IssueDetail>('member', `/issues/${created.identifier}`);
      assert(isDeepStrictEqual(read.document, full), 'Members read the stored document');
      const stored = await admin.query('select document_text from roster.issues where id=$1', [
        created.id,
      ]);
      assert(stored.rows[0].document_text === issueDocumentText(full), 'Plain text is stored');

      const defaults = await rest<Issue>('owner', '/issues', 'POST', {
        team: 'DOC',
        title: 'Defaults',
        document: { criteria: [{ id: 'AC-1', title: 'Defaults apply' }] },
      }, 201);
      assert(
        isDeepStrictEqual(defaults.document, {
          lead: '',
          sections: [],
          criteria: [{ id: 'AC-1', title: 'Defaults apply', detail: '', done: false }],
        }),
        JSON.stringify(defaults.document),
      );
      const bare = await rest<Issue>(
        'owner',
        '/issues',
        'POST',
        { team: 'DOC', title: 'Bare' },
        201,
      );
      assert(isDeepStrictEqual(bare.document, { lead: '', sections: [], criteria: [] }));

      const invalid: [unknown, string][] = [
        [
          {
            sections: [{
              title: 'T',
              blocks: [{ type: 'table', columns: ['a', 'b'], rows: [['1']] }],
            }],
          },
          'document.sections.0.blocks.0: Every table row needs one cell per column',
        ],
        [
          { criteria: [{ id: 'AC-1', title: 'a' }, { id: 'AC-1', title: 'b' }] },
          'document.criteria.1.id: Duplicate criterion ID AC-1',
        ],
        [{ lead: 'x', description: 'legacy' }, 'document: Unrecognized key: "description"'],
        [
          { sections: [{ title: 'T', blocks: [{ type: 'heading', text: 'x' }] }] },
          'document.sections.0.blocks.0',
        ],
      ];
      for (const [document, path] of invalid) {
        const body = { team: 'DOC', title: 'Invalid', document };
        const error = await rest<{ error: { message: string } }>(
          'owner',
          '/issues',
          'POST',
          body,
          400,
        );
        assert(error.error.message.includes(path), `REST: ${error.error.message}`);
        const failed = await call('owner', 'create_issue', body);
        assert(
          failed.isError && failed.content[0].text.includes(path),
          `MCP: ${failed.content[0].text}`,
        );
      }
      const legacy = await rest<{ error: { message: string } }>('owner', '/issues', 'POST', {
        team: 'DOC',
        title: 'Legacy',
        description: 'old body',
      }, 400);
      assert(
        legacy.error.message.includes('Unrecognized key: "description"'),
        legacy.error.message,
      );
      const mcpLegacy = await call('owner', 'update_issue', {
        identifier: created.identifier,
        description: 'old body',
      });
      assert(mcpLegacy.isError && mcpLegacy.content[0].text.includes('"description"'));
      assert(
        (await admin.query(
          "select count(*)::int as n from roster.issues where workspace_id=$1 and title in ('Invalid','Legacy')",
          [w.id],
        )).rows[0].n === 0,
        'Rejected documents are never stored',
      );

      const replacement: IssueDocument = {
        lead: 'Replaced through MCP.',
        sections: [],
        criteria: [{ id: 'AC-1', title: 'Only criterion', detail: '', done: false }],
      };
      const mcpCreated = await mcpOk('member', 'create_issue', {
        team: 'DOC',
        title: 'Agent issue',
        document: full,
      });
      assert(isDeepStrictEqual(mcpCreated.document, full), 'MCP create stores the document');
      const replaced = await mcpOk('member', 'update_issue', {
        identifier: mcpCreated.identifier,
        document: replacement,
      });
      assert(
        isDeepStrictEqual(replaced.document, replacement),
        'update_issue replaces the whole body',
      );
      const retitled = await rest<Issue>('owner', `/issues/${mcpCreated.identifier}`, 'PATCH', {
        title: 'Agent issue renamed',
      });
      assert(isDeepStrictEqual(retitled.document, replacement), 'Omitting document keeps it');
      const restReplaced = await rest<Issue>('owner', `/issues/${mcpCreated.identifier}`, 'PATCH', {
        document: { lead: 'REST replace' },
      });
      assert(
        isDeepStrictEqual(restReplaced.document, {
          lead: 'REST replace',
          sections: [],
          criteria: [],
        }),
      );

      const search = async (query: string) =>
        (await service.listIssues(owner, w.slug, { query, limit: -1 })).items.map((i) =>
          i.identifier
        );
      assert(
        (await search('zebracell')).includes(created.identifier),
        'Table cells are searchable',
      );
      assert(
        (await search('hidden blockers')).includes(created.identifier),
        'Notes are searchable',
      );
      for (const key of ['paragraph', 'sections', 'criteria', 'blocks', '"lead"', 'compare']) {
        assert((await search(key)).length === 0, `Search matched JSON key ${key}`);
      }
    } finally {
      for (const id of workspaces) await cleanupWorkspace(admin, id);
      for (const ctx of actors.values()) {
        await admin.query('delete from roster.users where subject=$1', [ctx.identity.subject]);
      }
      await runtime?.pool.end();
      await admin.end();
    }
  },
});

Deno.test({
  name: 'Issue document migration backfills legacy descriptions exactly like the import helper',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assert(url && new URL(url).pathname.endsWith('_test'));
    const admin = new Pool({ connectionString: url, max: 1 });
    const owner: RequestContext = {
      identity: { subject: crypto.randomUUID(), name: 'owner', email: 'owner@example.test' },
    };
    let workspace: string | undefined;
    try {
      await prepareTestDatabase(admin);
      const runtime = createDatabase(url);
      const service = createService(runtime.db);
      const w = await service.createWorkspace(owner, {
        slug: 'mig-' + crypto.randomUUID(),
        name: 'M',
      });
      workspace = w.id;
      await service.createTeam(owner, w.slug, { key: 'MIG', name: 'Migration' });
      await runtime.pool.end();
      const descriptions = [
        '',
        ' \n\t ',
        '<p>Legacy <b>HTML</b> stays literal.</p>\n',
        ' 　 Wide spaces trim ﻿',
        'Line one\n\n  indented line two',
        'a'.repeat(4999) + '\u{1F600}' + 'tail',
        '\u{1F600}'.repeat(3000),
        'x'.repeat(4990) + ' '.repeat(20) + 'y',
      ];
      const migration = await Deno.readTextFile(
        new URL(
          '../../../../supabase/migrations/20261105000200_issue_documents.sql',
          import.meta.url,
        ),
      );
      const client = await admin.connect();
      try {
        await client.query('begin');
        await client.query(
          "alter table roster.issues drop column document, drop column document_text, add column description text not null default ''",
        );
        const team = await client.query('select id from roster.teams where workspace_id=$1', [
          w.id,
        ]);
        for (const [index, description] of descriptions.entries()) {
          await client.query(
            'insert into roster.issues(workspace_id,team_id,number,identifier,title,description) values($1,$2,$3,$4,$5,$6)',
            [w.id, team.rows[0].id, index + 1, `MIG-${index + 1}`, 'Legacy', description],
          );
        }
        await client.query(migration);
        const migrated = await client.query(
          'select number,document,document_text from roster.issues where workspace_id=$1 order by number',
          [w.id],
        );
        for (const row of migrated.rows) {
          const expected = documentFromDescription(descriptions[row.number - 1]);
          assert(
            isDeepStrictEqual(row.document, expected),
            `MIG-${row.number}: ${JSON.stringify(row.document).slice(0, 200)}`,
          );
          assert(row.document_text === issueDocumentText(expected), `MIG-${row.number} text`);
          const paragraph = expected.sections[0]?.blocks[0];
          assert(!paragraph || (paragraph.type === 'paragraph' && paragraph.text.length <= 5000));
        }
        const column = await client.query(
          "select 1 from information_schema.columns where table_schema='roster' and table_name='issues' and column_name='description'",
        );
        assert(column.rows.length === 0, 'description is dropped');
      } finally {
        await client.query('rollback');
        client.release();
      }
    } finally {
      if (workspace) await cleanupWorkspace(admin, workspace);
      await admin.query('delete from roster.users where subject=$1', [owner.identity.subject]);
      await admin.end();
    }
  },
});
