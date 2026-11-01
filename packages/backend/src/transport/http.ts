import { Hono } from 'npm:hono@4.11.4';
import { cors } from 'npm:hono@4.11.4/cors';
import { z } from 'npm:zod@4.6.7';
import {
  AppError,
  changeTeamMemberSchema,
  createTeamSchema,
  createWorkspaceSchema,
  joinTeamSchema,
  joinWorkspaceSchema,
  type RequestContext,
  type Service,
  updateIssueSchema,
  updateMemberSchema,
  updateTeamSchema,
  updateWorkspaceSchema,
} from '../../../contracts/mod.ts';
import {
  capabilities,
  restCreateIssueSchema,
  restDetail,
  restIssue,
  restListInput,
  restTeam,
  restUpdateIssueSchema,
} from './compat.ts';
import type { VerifyIdentity } from '../auth/jwt.ts';
import * as activity from '../../../contracts/activity.ts';
import * as catalog from '../../../contracts/catalog.ts';
import * as cycles from '../../../contracts/cycles.ts';
import * as specs from '../../../contracts/spec.ts';
export interface TransportOptions {
  service: Service;
  verify: VerifyIdentity;
  allowedOrigins: string[];
}
export const errorStatus = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
} as const;
export function createHttpApp({ service: s, verify, allowedOrigins }: TransportOptions) {
  const app = new Hono<{ Variables: { requestContext: RequestContext } }>();
  app.use(
    '*',
    cors({
      origin: (origin) => allowedOrigins.includes(origin) ? origin : undefined,
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  );
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        errorStatus[error.code],
      );
    }
    if (error instanceof z.ZodError) {
      return c.json({
        error: { code: 'invalid_input', message: 'Invalid request', details: error.issues },
      }, 400);
    }
    return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500);
  });
  app.use('*', async (c, next) => {
    c.set('requestContext', await verify(c.req.raw));
    await next();
  });
  const body = async <T>(
    c: { req: { json: () => Promise<unknown>; header: (name: string) => string | undefined } },
    schema: z.ZodType<T>,
  ): Promise<T> => {
    if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      throw new AppError('invalid_input', 'Content-Type must be application/json');
    }
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      throw new AppError('invalid_input', 'Invalid JSON');
    }
    return schema.parse(input);
  };
  app.get('/auth/session', (c) => {
    const u = c.get('requestContext').identity;
    return c.json({
      enabled: true,
      user: { sub: u.subject, display_name: u.name, email: u.email },
    });
  });
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.get('/api/session', (c) => c.json(c.get('requestContext').identity));
  app.get(
    '/api/workspaces',
    async (c) => c.json({ workspaces: await s.listWorkspaces(c.get('requestContext')) }),
  );
  app.post(
    '/api/workspaces',
    async (c) =>
      c.json(
        await s.createWorkspace(c.get('requestContext'), await body(c, createWorkspaceSchema)),
        201,
      ),
  );
  app.post(
    '/api/join',
    async (c) =>
      c.json(await s.joinWorkspace(c.get('requestContext'), await body(c, joinWorkspaceSchema))),
  );
  app.patch(
    '/api/w/:workspace',
    async (c) =>
      c.json(
        await s.updateWorkspace(
          c.get('requestContext'),
          c.req.param('workspace'),
          await body(c, updateWorkspaceSchema),
        ),
      ),
  );
  app.patch(
    '/api/workspaces/:workspace',
    async (c) =>
      c.json(
        await s.updateWorkspace(
          c.get('requestContext'),
          c.req.param('workspace'),
          await body(c, updateWorkspaceSchema),
        ),
      ),
  );
  app.get('/api/w/:workspace/capabilities', async (c) => {
    await s.listTeams(c.get('requestContext'), c.req.param('workspace'));
    return c.json({ capabilities });
  });
  app.get(
    '/api/w/:workspace/teams/:key/assignees',
    async (c) =>
      c.json({
        assignees: await s.listAssignees(
          c.get('requestContext'),
          c.req.param('workspace'),
          c.req.param('key'),
        ),
      }),
  );
  app.get('/api/w/:workspace/access', async (c) => {
    const workspace = (await s.listWorkspaces(c.get('requestContext'))).find((w) =>
      w.slug === c.req.param('workspace')
    );
    if (!workspace) throw new AppError('forbidden', 'Workspace access denied');
    return c.json({
      enabled: true,
      role: workspace.role,
      subject: c.get('requestContext').identity.subject,
    });
  });
  app.get(
    '/api/w/:workspace/members',
    async (c) =>
      c.json({ members: await s.listMembers(c.get('requestContext'), c.req.param('workspace')) }),
  );
  app.patch('/api/w/:workspace/members', async (c) => {
    await s.updateMember(
      c.get('requestContext'),
      c.req.param('workspace'),
      await body(c, updateMemberSchema),
    );
    return c.json({ updated: true });
  });
  app.post('/api/w/:workspace/invite', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await s.resetInvite(c.get('requestContext'), c.req.param('workspace')));
  });
  app.get(
    '/api/w/:workspace/teams',
    async (c) =>
      c.json({
        teams: (await s.listTeams(c.get('requestContext'), c.req.param('workspace'))).map(restTeam),
      }),
  );
  app.get(
    '/api/w/:workspace/team-directory',
    async (c) =>
      c.json({
        teams: (await s.teamDirectory(c.get('requestContext'), c.req.param('workspace'))).map(
          restTeam,
        ),
      }),
  );
  app.post(
    '/api/w/:workspace/teams',
    async (c) =>
      c.json(
        restTeam(
          await s.createTeam(
            c.get('requestContext'),
            c.req.param('workspace'),
            await body(c, createTeamSchema),
          ),
        ),
        201,
      ),
  );
  app.patch(
    '/api/w/:workspace/teams/:key',
    async (c) =>
      c.json(
        restTeam(
          await s.updateTeam(
            c.get('requestContext'),
            c.req.param('workspace'),
            c.req.param('key'),
            await body(c, updateTeamSchema),
          ),
        ),
      ),
  );
  app.get(
    '/api/w/:workspace/teams/:key/members',
    async (c) =>
      c.json({
        members: await (async () => {
          const members = await s.listTeamMembers(
            c.get('requestContext'),
            c.req.param('workspace'),
            c.req.param('key'),
          );
          const workspaceMembers = await s.listMembers(
            c.get('requestContext'),
            c.req.param('workspace'),
          );
          return members.map((m) => ({
            ...m,
            workspace_admin: workspaceMembers.some((w) =>
              w.subject === m.subject && w.role === 'admin'
            ),
          }));
        })(),
      }),
  );
  app.patch('/api/w/:workspace/teams/:key/members', async (c) => {
    await s.changeTeamMember(
      c.get('requestContext'),
      c.req.param('workspace'),
      c.req.param('key'),
      await body(c, changeTeamMemberSchema),
    );
    return c.json({ updated: true });
  });
  app.post(
    '/api/w/:workspace/teams/:key/membership',
    async (c) =>
      c.json(
        restTeam(
          await s.joinTeam(
            c.get('requestContext'),
            c.req.param('workspace'),
            c.req.param('key'),
            await body(c, joinTeamSchema),
          ),
        ),
      ),
  );
  app.get('/api/w/:workspace/issues', async (c) => {
    const input = restListInput(c.req.queries());
    const page = await s.listIssues(c.get('requestContext'), c.req.param('workspace'), input);
    const issues = page.items.map(restIssue);
    return c.json({ ...page, items: issues, issues });
  });
  app.post(
    '/api/w/:workspace/issues',
    async (c) =>
      c.json(
        restIssue(
          await s.createIssue(
            c.get('requestContext'),
            c.req.param('workspace'),
            await body(c, restCreateIssueSchema),
          ),
        ),
        201,
      ),
  );
  app.get(
    '/api/w/:workspace/issues/:identifier',
    async (c) =>
      c.json(
        restDetail(
          await s.getIssue(
            c.get('requestContext'),
            c.req.param('workspace'),
            c.req.param('identifier'),
          ),
          await s.listMembers(c.get('requestContext'), c.req.param('workspace')),
        ),
      ),
  );
  app.patch(
    '/api/w/:workspace/issues/:identifier',
    async (c) =>
      c.json(
        restIssue(
          await s.updateIssue(
            c.get('requestContext'),
            c.req.param('workspace'),
            c.req.param('identifier'),
            await body(c, restUpdateIssueSchema),
          ),
        ),
      ),
  );
  app.patch(
    '/api/w/:workspace/issues/:identifier/status',
    async (c) =>
      c.json(
        restIssue(
          await s.updateIssue(
            c.get('requestContext'),
            c.req.param('workspace'),
            c.req.param('identifier'),
            await body(c, updateIssueSchema.pick({ status: true }).required()),
          ),
        ),
      ),
  );
  const queryBoolean = (value: string | undefined) => {
    if (value === undefined) return undefined;
    if (value !== 'true' && value !== 'false') {
      throw new AppError('invalid_input', 'Expected true or false');
    }
    return value === 'true';
  };
  const pathBody = async <T>(
    c: Parameters<typeof body>[0],
    schema: z.ZodType<T>,
    extra: Record<string, unknown>,
  ) => {
    const input = await body(c, z.record(z.string(), z.unknown()));
    for (const [key, value] of Object.entries(extra)) {
      if (input[key] !== undefined && input[key] !== value) {
        throw new AppError('invalid_input', 'Path and body references must match');
      }
    }
    return schema.parse({ ...input, ...extra });
  };
  app.get('/api/w/:workspace/projects', async (c) =>
    c.json({
      projects: await s.listProjects(
        c.get('requestContext'),
        c.req.param('workspace'),
        catalog.listProjectsSchema.parse({
          ...c.req.query(),
          ...(c.req.query('include_archived') !== undefined
            ? { include_archived: queryBoolean(c.req.query('include_archived')) }
            : {}),
        }),
      ),
    }));
  app.post(
    '/api/w/:workspace/projects',
    async (c) =>
      c.json(
        await s.createProject(
          c.get('requestContext'),
          c.req.param('workspace'),
          await body(c, catalog.createProjectSchema),
        ),
        201,
      ),
  );
  app.get(
    '/api/w/:workspace/projects/by-id/:id',
    async (c) =>
      c.json(
        await s.getProject(
          c.get('requestContext'),
          c.req.param('workspace'),
          catalog.getProjectSchema.parse({ id: Number(c.req.param('id')) }),
        ),
      ),
  );
  app.get(
    '/api/w/:workspace/projects/:name',
    async (c) =>
      c.json(
        await s.getProject(
          c.get('requestContext'),
          c.req.param('workspace'),
          catalog.getProjectSchema.parse({ name: c.req.param('name') }),
        ),
      ),
  );
  app.patch(
    '/api/w/:workspace/projects/by-id/:id',
    async (c) =>
      c.json(
        await s.updateProject(
          c.get('requestContext'),
          c.req.param('workspace'),
          await pathBody(c, catalog.updateProjectSchema, { id: Number(c.req.param('id')) }),
        ),
      ),
  );
  app.patch(
    '/api/w/:workspace/projects/:name',
    async (c) =>
      c.json(
        await s.updateProject(
          c.get('requestContext'),
          c.req.param('workspace'),
          await pathBody(c, catalog.updateProjectSchema, { name: c.req.param('name') }),
        ),
      ),
  );
  app.get('/api/w/:workspace/initiatives', async (c) =>
    c.json({
      initiatives: await s.listInitiatives(
        c.get('requestContext'),
        c.req.param('workspace'),
        catalog.listInitiativesSchema.parse({
          ...c.req.query(),
          ...(c.req.query('include_archived') !== undefined
            ? { include_archived: queryBoolean(c.req.query('include_archived')) }
            : {}),
        }),
      ),
    }));
  app.post(
    '/api/w/:workspace/initiatives',
    async (c) =>
      c.json(
        await s.createInitiative(
          c.get('requestContext'),
          c.req.param('workspace'),
          await body(c, catalog.createInitiativeSchema),
        ),
        201,
      ),
  );
  app.get(
    '/api/w/:workspace/initiatives/:id',
    async (c) =>
      c.json(
        await s.getInitiative(
          c.get('requestContext'),
          c.req.param('workspace'),
          catalog.getInitiativeSchema.parse({ id: Number(c.req.param('id')) }),
        ),
      ),
  );
  app.patch(
    '/api/w/:workspace/initiatives/:id',
    async (c) =>
      c.json(
        await s.updateInitiative(
          c.get('requestContext'),
          c.req.param('workspace'),
          await pathBody(c, catalog.updateInitiativeSchema, { id: Number(c.req.param('id')) }),
        ),
      ),
  );
  app.get('/api/w/:workspace/labels', async (c) =>
    c.json({
      labels: await s.listLabels(
        c.get('requestContext'),
        c.req.param('workspace'),
        catalog.listLabelsSchema.parse({
          ...c.req.query(),
          ...(c.req.query('include_archived') !== undefined
            ? { include_archived: queryBoolean(c.req.query('include_archived')) }
            : {}),
        }),
      ),
    }));
  app.post(
    '/api/w/:workspace/labels',
    async (c) =>
      c.json(
        await s.createLabel(
          c.get('requestContext'),
          c.req.param('workspace'),
          await body(c, catalog.createLabelSchema),
        ),
        201,
      ),
  );
  app.patch(
    '/api/w/:workspace/labels/:id',
    async (c) =>
      c.json(
        await s.updateLabel(
          c.get('requestContext'),
          c.req.param('workspace'),
          await pathBody(c, catalog.updateLabelSchema, { id: Number(c.req.param('id')) }),
        ),
      ),
  );
  app.get(
    '/api/w/:workspace/label-groups',
    async (c) =>
      c.json({
        groups: await s.listLabelGroups(
          c.get('requestContext'),
          c.req.param('workspace'),
          catalog.listLabelGroupsSchema.parse(c.req.query()),
        ),
      }),
  );
  app.post(
    '/api/w/:workspace/label-groups',
    async (c) =>
      c.json(
        await s.saveLabelGroup(
          c.get('requestContext'),
          c.req.param('workspace'),
          await body(c, catalog.saveLabelGroupSchema),
        ),
      ),
  );
  app.post('/api/w/:workspace/labels/merge', async (c) => {
    await s.mergeLabels(
      c.get('requestContext'),
      c.req.param('workspace'),
      await body(c, catalog.mergeLabelsSchema),
    );
    return c.json({ updated: true });
  });
  app.post('/api/w/:workspace/issue-labels', async (c) => {
    await s.changeIssueLabels(
      c.get('requestContext'),
      c.req.param('workspace'),
      await body(c, catalog.changeIssueLabelsSchema),
    );
    return c.json({ updated: true });
  });
  app.get(
    '/api/w/:workspace/teams/:key/cycles',
    async (c) =>
      c.json(
        await s.listCycles(c.get('requestContext'), c.req.param('workspace'), c.req.param('key')),
      ),
  );
  app.put(
    '/api/w/:workspace/teams/:key/cycles',
    async (c) =>
      c.json(
        await s.configureCycles(
          c.get('requestContext'),
          c.req.param('workspace'),
          c.req.param('key'),
          await body(c, cycles.configureCyclesSchema),
        ),
      ),
  );
  app.get(
    '/api/w/:workspace/cycles/:id',
    async (c) =>
      c.json(
        await s.getCycle(
          c.get('requestContext'),
          c.req.param('workspace'),
          z.number().int().positive().parse(Number(c.req.param('id'))),
        ),
      ),
  );
  app.patch(
    '/api/w/:workspace/cycles/:id',
    async (c) =>
      c.json(
        await s.updateCycle(
          c.get('requestContext'),
          c.req.param('workspace'),
          z.number().int().positive().parse(Number(c.req.param('id'))),
          await body(c, cycles.updateCycleSchema),
        ),
      ),
  );
  app.post(
    '/api/w/:workspace/issues/:identifier/comments',
    async (c) =>
      c.json(
        await s.addComment(
          c.get('requestContext'),
          c.req.param('workspace'),
          await pathBody(c, activity.addCommentSchema, { identifier: c.req.param('identifier') }),
        ),
        201,
      ),
  );
  app.post(
    '/api/w/:workspace/issues/:identifier/work-logs',
    async (c) =>
      c.json(
        await s.addWorkLog(
          c.get('requestContext'),
          c.req.param('workspace'),
          await pathBody(c, activity.addWorkLogSchema, { identifier: c.req.param('identifier') }),
        ),
        201,
      ),
  );
  app.get('/api/w/:workspace/issues/:identifier/work-logs', async (c) => {
    const q = c.req.query();
    return c.json(
      await s.listWorkLogs(
        c.get('requestContext'),
        c.req.param('workspace'),
        activity.listWorkLogsSchema.parse({
          ...q,
          identifier: c.req.param('identifier'),
          ...(q.limit !== undefined ? { limit: Number(q.limit) } : {}),
          ...(q.before !== undefined ? { before: Number(q.before) } : {}),
        }),
      ),
    );
  });
  app.get(
    '/api/w/:workspace/issues/:identifier/work-logs/:id',
    async (c) =>
      c.json(
        await s.getWorkLog(
          c.get('requestContext'),
          c.req.param('workspace'),
          activity.getWorkLogSchema.parse({
            identifier: c.req.param('identifier'),
            id: Number(c.req.param('id')),
          }),
        ),
      ),
  );
  app.post(
    '/api/w/:workspace/issues/:identifier/delegate',
    async (c) =>
      c.json(
        await s.delegateIssue(
          c.get('requestContext'),
          c.req.param('workspace'),
          await pathBody(c, activity.delegateIssueSchema, {
            identifier: c.req.param('identifier'),
          }),
        ),
      ),
  );
  app.post(
    '/api/w/:workspace/issues/:identifier/links',
    async (c) =>
      c.json(
        await s.addLink(
          c.get('requestContext'),
          c.req.param('workspace'),
          await pathBody(c, activity.addLinkSchema, { identifier: c.req.param('identifier') }),
        ),
        201,
      ),
  );
  app.post('/api/w/:workspace/issues/:identifier/relations', async (c) => {
    await s.addRelation(
      c.get('requestContext'),
      c.req.param('workspace'),
      await pathBody(c, activity.addRelationSchema, { identifier: c.req.param('identifier') }),
    );
    return c.json({ updated: true });
  });
  app.get('/api/w/:workspace/specs', async (c) => {
    const query = c.req.queries();
    const input: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value.length !== 1) throw new AppError('invalid_input', 'Repeated query parameter');
      input[key] = value[0];
    }
    return c.json({
      specs: await s.listSpecs(
        c.get('requestContext'),
        c.req.param('workspace'),
        specs.listSpecsSchema.parse(input),
      ),
    });
  });
  app.post(
    '/api/w/:workspace/specs',
    async (c) =>
      c.json(
        await s.createSpec(
          c.get('requestContext'),
          c.req.param('workspace'),
          await body(c, specs.createSpecSchema),
        ),
        201,
      ),
  );
  app.get(
    '/api/w/:workspace/specs/:identifier',
    async (c) =>
      c.json(
        await s.getSpec(
          c.get('requestContext'),
          c.req.param('workspace'),
          specs.getSpecSchema.parse({ identifier: c.req.param('identifier') }).identifier,
        ),
      ),
  );
  app.put('/api/w/:workspace/specs/:identifier', async (c) => {
    // The original REST body has no identifier; reject attempts to supply one,
    // even if it matches. Only the URL selects which spec is updated.
    const input = await body(c, specs.updateSpecSchema.omit({ identifier: true }));
    return c.json(
      await s.updateSpec(
        c.get('requestContext'),
        c.req.param('workspace'),
        specs.updateSpecSchema.parse({ ...input, identifier: c.req.param('identifier') }),
      ),
    );
  });
  app.get(
    '/api/w/:workspace/specs/:identifier/revisions',
    async (c) =>
      c.json({
        revisions: await s.listSpecRevisions(
          c.get('requestContext'),
          c.req.param('workspace'),
          specs.listSpecRevisionsSchema.parse({ identifier: c.req.param('identifier') }).identifier,
        ),
      }),
  );
  app.get(
    '/api/w/:workspace/specs/:identifier/revisions/:number',
    async (c) =>
      c.json(
        await s.getSpecRevision(
          c.get('requestContext'),
          c.req.param('workspace'),
          specs.getSpecRevisionSchema.parse({
            identifier: c.req.param('identifier'),
            number: Number(c.req.param('number')),
          }),
        ),
      ),
  );
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
  return app;
}
