import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@2.4.0';
import { z } from 'npm:zod@4.6.7';
import {
  AppError,
  changeTeamMemberSchema,
  createIssueSchema,
  createTeamSchema,
  createWorkspaceSchema,
  joinTeamSchema,
  joinWorkspaceSchema,
  listIssuesSchema,
  type RequestContext,
  type Service,
  updateIssueSchema,
  updateMemberSchema,
  updateTeamSchema,
  updateWorkspaceSchema,
} from '../../../contracts/mod.ts';
import type { VerifyIdentity } from '../auth/jwt.ts';
export interface McpOptions {
  service: Service;
  verify: VerifyIdentity;
  publicUrl: string;
  authorizationServer: string;
  allowedOrigins: string[];
}
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
// Outputs permit additive fields while exposing stable core issue contracts.
const identityOutput = z.object({ subject: z.string(), name: z.string(), email: z.string() })
  .passthrough();
const issueOutput = z.object({
  id: z.string().uuid(),
  identifier: z.string(),
  team: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum([
    'triage',
    'backlog',
    'todo',
    'agent_ready',
    'in_progress',
    'in_review',
    'done',
    'canceled',
  ]),
  type: z.enum(['spec', 'feature', 'bug', 'improvement', 'chore']).nullable(),
  priority: z.number().int(),
  assignee: identityOutput.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();
const resultSchemas: Record<string, z.ZodType> = {
  list_issues: z.object({ items: z.array(issueOutput), next_cursor: z.string().uuid().nullable() })
    .passthrough(),
  get_issue: issueOutput.extend({
    audit: z.array(
      z.object({
        id: z.string().uuid(),
        kind: z.string(),
        actor_subject: z.string(),
        before: z.unknown(),
        after: z.unknown(),
        created_at: z.string(),
      }).passthrough(),
    ),
  }),
  create_issue: issueOutput,
  update_issue: issueOutput,
};
export function createMcpServer(service: Service, ctx: RequestContext, workspace: string) {
  const server = new McpServer({ name: 'roster', version: '0.1.0' });
  function tool<T extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: T,
    readOnly: boolean,
    run: (input: z.infer<z.ZodObject<T>>) => Promise<unknown>,
  ) {
    server.registerTool(name, {
      description,
      inputSchema: z.strictObject(shape),
      outputSchema: z.object({ result: resultSchemas[name] ?? z.unknown() }).passthrough(),
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
    }, async (input) => {
      try {
        const result = (await run(input)) ?? { updated: true };
        return {
          structuredContent: { result },
          content: [{ type: 'text' as const, text: JSON.stringify({ result }) }],
        };
      } catch (error) {
        if (error instanceof AppError) {
          return {
            isError: true,
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: { code: error.code, message: error.message } }),
            }],
          };
        }
        return {
          isError: true,
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: { code: 'internal', message: 'Internal server error' } }),
          }],
        };
      }
    });
  }
  tool(
    'list_workspaces',
    'List the current user’s active workspaces.',
    {},
    true,
    () => service.listWorkspaces(ctx),
  );
  tool(
    'create_workspace',
    'Create a workspace with the caller as administrator.',
    createWorkspaceSchema.shape,
    false,
    (i) => service.createWorkspace(ctx, i),
  );
  tool(
    'update_workspace',
    'Rename this workspace (administrator only).',
    updateWorkspaceSchema.shape,
    false,
    (i) => service.updateWorkspace(ctx, workspace, i),
  );
  tool(
    'list_members',
    'List workspace members (active workspace membership required).',
    {},
    true,
    () => service.listMembers(ctx, workspace),
  );
  tool(
    'update_member',
    'Change workspace membership (administrator only).',
    updateMemberSchema.shape,
    false,
    (i) => service.updateMember(ctx, workspace, i),
  );
  tool(
    'reset_invite',
    'Reset reusable workspace invitation (administrator only).',
    {},
    false,
    () => service.resetInvite(ctx, workspace),
  );
  tool(
    'join_workspace',
    'Join a workspace using an invitation.',
    joinWorkspaceSchema.shape,
    false,
    (i) => service.joinWorkspace(ctx, i),
  );
  tool(
    'list_teams',
    'List teams whose content the caller can access.',
    {},
    true,
    () => service.listTeams(ctx, workspace),
  );
  tool(
    'team_directory',
    'List team directory, including discoverable private team metadata.',
    {},
    true,
    () => service.teamDirectory(ctx, workspace),
  );
  tool(
    'create_team',
    'Create a team; the caller becomes its owner.',
    createTeamSchema.shape,
    false,
    (i) => service.createTeam(ctx, workspace, i),
  );
  tool(
    'update_team',
    'Update team metadata or privacy as an authorized manager.',
    { key: z.string(), ...updateTeamSchema.shape },
    false,
    ({ key, ...i }) => service.updateTeam(ctx, workspace, key, i),
  );
  tool(
    'list_team_members',
    'List members of an accessible team.',
    { key: z.string() },
    true,
    ({ key }) => service.listTeamMembers(ctx, workspace, key),
  );
  tool(
    'change_team_member',
    'Manage team members as an authorized manager.',
    { key: z.string(), ...changeTeamMemberSchema.shape },
    false,
    ({ key, ...i }) => service.changeTeamMember(ctx, workspace, key, i),
  );
  tool(
    'join_team',
    'Join or leave a team; private join requires confirmation.',
    { key: z.string(), ...joinTeamSchema.shape },
    false,
    ({ key, ...i }) => service.joinTeam(ctx, workspace, key, i),
  );
  tool(
    'list_issues',
    'List visible workspace issues with cursor pagination.',
    listIssuesSchema.shape,
    true,
    (i) => service.listIssues(ctx, workspace, i),
  );
  tool(
    'get_issue',
    'Read a visible issue and its audit history.',
    { identifier: z.string() },
    true,
    (i) => service.getIssue(ctx, workspace, i.identifier),
  );
  tool(
    'create_issue',
    'Create an issue in an accessible team.',
    createIssueSchema.shape,
    false,
    (i) => service.createIssue(ctx, workspace, i),
  );
  tool(
    'update_issue',
    'Update a visible issue; omitted properties remain unchanged.',
    { identifier: z.string(), ...updateIssueSchema.shape },
    false,
    ({ identifier, ...i }) => service.updateIssue(ctx, workspace, identifier, i),
  );
  return server;
}
export function createMcpFetch(options: McpOptions) {
  const base = options.publicUrl.replace(/\/$/, '');
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const metadataPrefix = '/.well-known/oauth-protected-resource';
    const discovery = url.pathname.startsWith(metadataPrefix);
    const path = discovery ? url.pathname.slice(metadataPrefix.length) : url.pathname;
    const match = /^\/w\/([^/]+)\/mcp$/.exec(path);
    if (!match || !slugSchema.safeParse(match[1]).success) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const resource = `${base}${path}`;
    const metadata = `${base}${metadataPrefix}${path}`;
    const origin = request.headers.get('Origin');
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    if (origin && options.allowedOrigins.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Vary', 'Origin');
      headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Protocol-Version');
    }
    if (origin && !options.allowedOrigins.includes(origin)) {
      return Response.json({ error: 'Origin not allowed' }, { status: 403, headers });
    }
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      headers.set(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id',
      );
      return new Response(null, { status: 204, headers });
    }
    if (discovery) {
      if (request.method !== 'GET') return new Response(null, { status: 405, headers });
      return Response.json({
        resource,
        authorization_servers: [options.authorizationServer],
        bearer_methods_supported: ['header'],
      }, { headers });
    }
    let ctx: RequestContext;
    try {
      ctx = await options.verify(request);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      headers.set('WWW-Authenticate', `Bearer resource_metadata="${metadata}"`);
      return Response.json({ error: { code: error.code, message: error.message } }, {
        status: 401,
        headers,
      });
    }
    const handler = createMcpHandler(() => createMcpServer(options.service, ctx, match[1]));
    const response = await handler.fetch(request);
    for (const [key, value] of headers) response.headers.set(key, value);
    return response;
  };
}
