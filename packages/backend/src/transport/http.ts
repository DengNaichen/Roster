import { Hono } from 'npm:hono@4.11.4';
import { cors } from 'npm:hono@4.11.4/cors';
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
      allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
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
      c.json({ teams: await s.listTeams(c.get('requestContext'), c.req.param('workspace')) }),
  );
  app.get(
    '/api/w/:workspace/team-directory',
    async (c) =>
      c.json({ teams: await s.teamDirectory(c.get('requestContext'), c.req.param('workspace')) }),
  );
  app.post(
    '/api/w/:workspace/teams',
    async (c) =>
      c.json(
        await s.createTeam(
          c.get('requestContext'),
          c.req.param('workspace'),
          await body(c, createTeamSchema),
        ),
        201,
      ),
  );
  app.patch(
    '/api/w/:workspace/teams/:key',
    async (c) =>
      c.json(
        await s.updateTeam(
          c.get('requestContext'),
          c.req.param('workspace'),
          c.req.param('key'),
          await body(c, updateTeamSchema),
        ),
      ),
  );
  app.get(
    '/api/w/:workspace/teams/:key/members',
    async (c) =>
      c.json({
        members: await s.listTeamMembers(
          c.get('requestContext'),
          c.req.param('workspace'),
          c.req.param('key'),
        ),
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
        await s.joinTeam(
          c.get('requestContext'),
          c.req.param('workspace'),
          c.req.param('key'),
          await body(c, joinTeamSchema),
        ),
      ),
  );
  app.get('/api/w/:workspace/issues', async (c) => {
    const q = c.req.query();
    if (q.search !== undefined) {
      q.query = q.search;
      delete q.search;
    }
    const input = listIssuesSchema.parse({
      ...q,
      ...(q.limit !== undefined ? { limit: Number(q.limit) } : {}),
    });
    return c.json(await s.listIssues(c.get('requestContext'), c.req.param('workspace'), input));
  });
  app.post(
    '/api/w/:workspace/issues',
    async (c) =>
      c.json(
        await s.createIssue(
          c.get('requestContext'),
          c.req.param('workspace'),
          await body(c, createIssueSchema),
        ),
        201,
      ),
  );
  app.get(
    '/api/w/:workspace/issues/:identifier',
    async (c) =>
      c.json(
        await s.getIssue(
          c.get('requestContext'),
          c.req.param('workspace'),
          c.req.param('identifier'),
        ),
      ),
  );
  app.patch(
    '/api/w/:workspace/issues/:identifier',
    async (c) =>
      c.json(
        await s.updateIssue(
          c.get('requestContext'),
          c.req.param('workspace'),
          c.req.param('identifier'),
          await body(c, updateIssueSchema),
        ),
      ),
  );
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
  return app;
}
