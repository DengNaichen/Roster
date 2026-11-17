import { authorizationIdSchema } from '../../../../contracts/oauth.ts';
import { Hono } from 'npm:hono@4.11.4';
import { bodyLimit } from 'npm:hono@4.11.4/body-limit';
import { cors } from 'npm:hono@4.11.4/cors';
import { z } from 'npm:zod@4.6.7';
import { AppError } from '../../../../contracts/mod.ts';
import type { OAuthService } from '../../integrations/oauth/index.ts';
import type { VerifyIdentity } from '../../platform/auth/jwt.ts';
import { errorStatus } from '../http/app.ts';
export function createOAuthTransport(options: {
  oauth: OAuthService;
  verify: VerifyIdentity;
  publicUrl: string;
  resourceUrl: string;
  allowedOrigins: string[];
}) {
  const { oauth, verify, allowedOrigins } = options;
  const base = options.publicUrl.replace(/\/$/, '');
  const app = new Hono();
  app.use(
    '*',
    cors({
      origin: (origin) => allowedOrigins.includes(origin) ? origin : undefined,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'x-region'],
    }),
  );
  app.use(
    '*',
    bodyLimit({ maxSize: 16384, onError: (c) => c.json({ error: 'invalid_request' }, 413) }),
  );
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        errorStatus[error.code],
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    return c.json({ error: 'server_error' }, 500);
  });
  app.get('/.well-known/oauth-authorization-server', (c) =>
    c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['read', 'write'],
    }));
  app.get('/oauth/authorize', async (c) => {
    const params = new URL(c.req.url).searchParams;
    const resource = params.get('resource');
    const legacyResource = resource?.startsWith(options.resourceUrl) &&
      /^\/w\/[a-z0-9][a-z0-9-]{0,62}\/mcp$/.test(resource.slice(options.resourceUrl.length));
    if (
      resource && !legacyResource &&
      ![`${options.resourceUrl}/mcp`, `${options.resourceUrl}/mcp/readonly`].includes(resource)
    ) {
      return c.json({ error: 'invalid_target' }, 400);
    }
    if (resource === `${options.resourceUrl}/mcp/readonly`) params.set('scope', 'read');
    return await oauth.authorize(params);
  });
  app.post('/oauth/register', (c) => oauth.register(c.req.raw));
  app.post('/oauth/token', async (c) => {
    if (!(c.req.header('Content-Type') ?? '').startsWith('application/x-www-form-urlencoded')) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    try {
      return await oauth.token(c.req.raw);
    } catch (error) {
      if (error instanceof AppError) {
        return c.json({ error: 'invalid_grant', error_description: error.message }, 400);
      }
      throw error;
    }
  });
  const selection = z.strictObject({
    workspace: z.string().min(1).max(63),
    access: z.enum(['read', 'read_write']),
  });
  app.get(
    '/api/oauth/authorizations/:id',
    async (c) =>
      c.json(
        await oauth.details(
          await verify(c.req.raw),
          authorizationIdSchema.parse(c.req.param('id')),
        ),
      ),
  );
  app.post('/api/oauth/authorizations/:id', async (c) => {
    const origin = c.req.header('Origin');
    if (!origin || !allowedOrigins.includes(origin)) return c.json({ error: 'forbidden' }, 403);
    if (!(c.req.header('Content-Type') ?? '').startsWith('application/json')) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const ctx = await verify(c.req.raw);
    const id = authorizationIdSchema.parse(c.req.param('id'));
    const body = await c.req.json();
    if (body?.action === 'deny') {
      z.strictObject({ action: z.literal('deny') }).parse(body);
      return c.json(await oauth.deny(ctx, id));
    }
    const input = selection.parse(body);
    return c.json(
      await oauth.approve(ctx, c.req.header('Authorization')!, id, input.workspace, input.access),
    );
  });
  return app.fetch;
}
