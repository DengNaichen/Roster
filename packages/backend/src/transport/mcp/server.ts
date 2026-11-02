import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@2.4.0';
import { z } from 'npm:zod@4.6.7';
import * as activity from '../../../../contracts/activity.ts';
import * as catalog from '../../../../contracts/catalog.ts';
import * as cycles from '../../../../contracts/cycles.ts';
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
  updateIssueSchema,
  updateMemberSchema,
  updateTeamSchema,
  updateWorkspaceSchema,
} from '../../../../contracts/mod.ts';
import * as specs from '../../../../contracts/spec.ts';
import type { Service } from '../../application/mod.ts';
import type { VerifyIdentity } from '../../platform/auth/jwt.ts';
import { restCreateIssueSchema, restUpdateIssueSchema } from '../http/compat.ts';
const compatibleIssueFields = {
  type: z.union([createIssueSchema.shape.type, z.literal('')]),
  assignee: z.union([createIssueSchema.shape.assignee, z.literal('')]),
};
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
const specStatusOutput = z.enum(['draft', 'review', 'approved', 'superseded']);
const specIdentifierOutput = z.string().regex(/^SPEC-[1-9][0-9]*$/);
const specContentOutput = z.object({
  title: z.string(),
  status: specStatusOutput,
  branch: z.string().optional(),
  stories: z.array(
    z.object({
      id: z.string().regex(/^US-[0-9]+$/),
      title: z.string(),
      priority: z.enum(['P1', 'P2', 'P3']),
      description: z.string(),
      why: z.string(),
      independent_test: z.string(),
      scenarios: z.array(
        z.object({ given: z.string(), when: z.string(), then: z.string() }).passthrough(),
      ),
    }).passthrough(),
  ),
  edge_cases: z.array(z.string()),
  requirements: z.array(
    z.object({
      id: z.string().regex(/^FR-[0-9]+$/),
      text: z.string(),
      clarify: z.string().optional(),
    }).passthrough(),
  ),
  entities: z.array(z.object({ name: z.string(), description: z.string() }).passthrough()),
  success_criteria: z.array(
    z.object({ id: z.string().regex(/^SC-[0-9]+$/), text: z.string() }).passthrough(),
  ),
  clarifications: z.array(
    z.object({
      date: z.string(),
      items: z.array(z.object({ question: z.string(), answer: z.string() }).passthrough()),
    }).passthrough(),
  ),
}).passthrough();
const specRevisionOutput = z.object({
  number: z.number().int().positive(),
  message: z.string(),
  author: identityOutput.nullable(),
  created_at: z.string(),
}).passthrough();
const specSummaryOutput = z.object({
  identifier: specIdentifierOutput,
  team: z.string(),
  title: z.string(),
  status: specStatusOutput,
  revision: z.number().int().positive(),
  updated_at: z.string(),
}).passthrough();
const specOutput = z.object({
  identifier: specIdentifierOutput,
  team: z.string(),
  revision: z.number().int().positive(),
  message: z.string(),
  author: identityOutput.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  content: specContentOutput,
}).passthrough();
const resultSchemas: Record<string, z.ZodType> = {
  list_specs: z.array(specSummaryOutput),
  get_spec: specOutput,
  create_spec: specOutput,
  update_spec: specOutput,
  list_spec_revisions: z.array(specRevisionOutput),
  get_spec_revision: specRevisionOutput.extend({ content: specContentOutput }),
  list_issues: z.object({ items: z.array(issueOutput), next_cursor: z.string().uuid().nullable() })
    .passthrough(),
  get_issue: issueOutput.extend({
    audit: z.array(
      z.object({
        id: z.string().regex(/^[1-9][0-9]*$/),
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
    createIssueSchema.extend(compatibleIssueFields).shape,
    false,
    (i) => service.createIssue(ctx, workspace, restCreateIssueSchema.parse(i)),
  );
  tool(
    'update_issue',
    'Update a visible issue; omitted properties remain unchanged.',
    { identifier: z.string(), ...updateIssueSchema.extend(compatibleIssueFields).shape },
    false,
    ({ identifier, ...i }) =>
      service.updateIssue(ctx, workspace, identifier, restUpdateIssueSchema.parse(i)),
  );
  tool(
    'list_assignees',
    'List active human assignees with access to the team.',
    { team: z.string() },
    true,
    (i) => service.listAssignees(ctx, workspace, i.team),
  );
  tool(
    'list_team_directory',
    'List team directory including discoverable private metadata.',
    {},
    true,
    () => service.teamDirectory(ctx, workspace),
  );
  tool(
    'add_comment',
    'Append a comment attributed to the authenticated caller.',
    activity.addCommentSchema.shape,
    false,
    (i) => service.addComment(ctx, workspace, i),
  );
  tool(
    'add_work_log',
    'Record progress or a settled decision with its rationale.',
    activity.addWorkLogSchema.shape,
    false,
    (i) => service.addWorkLog(ctx, workspace, i),
  );
  tool(
    'list_work_logs',
    'List work log summaries, newest first, with numeric before cursor.',
    activity.listWorkLogsSchema.shape,
    true,
    (i) => service.listWorkLogs(ctx, workspace, i),
  );
  tool(
    'get_work_log',
    'Read one work log body belonging to this issue.',
    activity.getWorkLogSchema.shape,
    true,
    (i) => service.getWorkLog(ctx, workspace, i),
  );
  tool(
    'delegate_issue',
    'Register client-reported execution provenance, never an authorization identity. Requires a human assignee on every call. Idempotent registration; starts or restarts in_progress without changing assignee.',
    activity.delegateIssueSchema.shape,
    false,
    (i) => service.delegateIssue(ctx, workspace, i),
  );
  tool(
    'add_relation',
    'Add blocks, blocked_by or undirected related relation. Blocking dependencies must remain acyclic.',
    activity.addRelationSchema.omit({ remove: true }).shape,
    false,
    (i) => service.addRelation(ctx, workspace, { ...i, remove: false }),
  );
  tool(
    'remove_relation',
    'Remove a relation; absent relations succeed.',
    activity.addRelationSchema.omit({ remove: true }).shape,
    false,
    (i) => service.addRelation(ctx, workspace, { ...i, remove: true }),
  );
  tool(
    'add_link',
    'Attach a titled HTTP(S) URL without credentials.',
    activity.addLinkSchema.shape,
    false,
    (i) => service.addLink(ctx, workspace, i),
  );
  tool(
    'list_projects',
    'List visible projects; archived projects are opt-in.',
    catalog.listProjectsSchema.shape,
    true,
    (i) => service.listProjects(ctx, workspace, i),
  );
  tool(
    'get_project',
    'Read a visible project by id or current name; both must agree.',
    catalog.getProjectSchema.shape,
    true,
    (i) => service.getProject(ctx, workspace, i),
  );
  tool(
    'create_project',
    'Create a project attached to existing teams.',
    catalog.createProjectSchema.shape,
    false,
    (i) => service.createProject(ctx, workspace, i),
  );
  tool(
    'update_project',
    'Update project metadata or team links; omitted fields are unchanged.',
    catalog.updateProjectSchema.shape,
    false,
    (i) => service.updateProject(ctx, workspace, i),
  );
  tool(
    'list_initiatives',
    'List initiatives and associated projects.',
    catalog.listInitiativesSchema.shape,
    true,
    (i) => service.listInitiatives(ctx, workspace, i),
  );
  tool(
    'get_initiative',
    'Read an initiative by stable id.',
    catalog.getInitiativeSchema.shape,
    true,
    (i) => service.getInitiative(ctx, workspace, i),
  );
  tool(
    'create_initiative',
    'Create an initiative with optional project links.',
    catalog.createInitiativeSchema.shape,
    false,
    (i) => service.createInitiative(ctx, workspace, i),
  );
  tool(
    'update_initiative',
    'Update an initiative and project links.',
    catalog.updateInitiativeSchema.shape,
    false,
    (i) => service.updateInitiative(ctx, workspace, i),
  );
  tool(
    'list_labels',
    'List workspace labels, optionally including archived labels.',
    catalog.listLabelsSchema.shape,
    true,
    (i) => service.listLabels(ctx, workspace, i),
  );
  tool(
    'list_label_groups',
    'List workspace label groups.',
    catalog.listLabelGroupsSchema.shape,
    true,
    (i) => service.listLabelGroups(ctx, workspace, i),
  );
  tool(
    'save_label_group',
    'Create or rename a label group.',
    catalog.saveLabelGroupSchema.shape,
    false,
    (i) => service.saveLabelGroup(ctx, workspace, i),
  );
  tool(
    'create_label',
    'Create a label with a validated hex color.',
    catalog.createLabelSchema.shape,
    false,
    (i) => service.createLabel(ctx, workspace, i),
  );
  tool(
    'update_label',
    'Update or archive a label.',
    catalog.updateLabelSchema.shape,
    false,
    (i) => service.updateLabel(ctx, workspace, i),
  );
  tool(
    'change_issue_labels',
    'Atomically add and remove labels on visible issues.',
    catalog.changeIssueLabelsSchema.shape,
    false,
    (i) => service.changeIssueLabels(ctx, workspace, i),
  );
  tool(
    'merge_labels',
    'Merge a source label into a distinct target label.',
    catalog.mergeLabelsSchema.shape,
    false,
    (i) => service.mergeLabels(ctx, workspace, i),
  );
  tool(
    'list_cycles',
    'List a team’s configured current, upcoming and completed cycles.',
    { team: z.string() },
    true,
    (i) => service.listCycles(ctx, workspace, i.team),
  );
  tool(
    'configure_cycles',
    'Configure team cycle scheduling.',
    { team: z.string(), ...cycles.configureCyclesSchema.shape },
    false,
    ({ team, ...i }) => service.configureCycles(ctx, workspace, team, i),
  );
  tool(
    'get_cycle',
    'Read cycle metadata and issue totals.',
    { id: z.number().int().positive() },
    true,
    (i) => service.getCycle(ctx, workspace, i.id),
  );
  tool(
    'update_cycle',
    'Update cycle name or description.',
    { id: z.number().int().positive(), ...cycles.updateCycleSchema.shape },
    false,
    ({ id, ...i }) => service.updateCycle(ctx, workspace, id, i),
  );
  tool(
    'list_specs',
    'List readable team spec summaries, newest updated first.',
    specs.listSpecsSchema.shape,
    true,
    (i) => service.listSpecs(ctx, workspace, i),
  );
  tool(
    'get_spec',
    'Read the current structured Spec Kit content and trusted author.',
    specs.getSpecSchema.shape,
    true,
    (i) => service.getSpec(ctx, workspace, i.identifier),
  );
  tool(
    'create_spec',
    'Create a team spec as revision 1. Content is structured JSON with stable US/FR/SC ids.',
    specs.createSpecSchema.shape,
    false,
    (i) => service.createSpec(ctx, workspace, i),
  );
  tool(
    'update_spec',
    'Save complete content as an append-only revision. Supply base_revision; conflicts require re-reading before retry. Retired stable IDs cannot be reused.',
    specs.updateSpecSchema.shape,
    false,
    (i) => service.updateSpec(ctx, workspace, i),
  );
  tool(
    'list_spec_revisions',
    'List immutable revision summaries newest first.',
    specs.listSpecRevisionsSchema.shape,
    true,
    (i) => service.listSpecRevisions(ctx, workspace, i.identifier),
  );
  tool(
    'get_spec_revision',
    'Read historical revision content without modifying history.',
    specs.getSpecRevisionSchema.shape,
    true,
    (i) => service.getSpecRevision(ctx, workspace, i),
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
