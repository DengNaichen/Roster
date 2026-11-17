import { AppError, type RequestContext, type Workspace } from '../../../../../contracts/mod.ts';
import type { VerifyIdentity } from '../../../platform/auth/jwt.ts';
import type { Access, Grant, OAuthRepository, OAuthService, OAuthUpstream } from '../index.ts';
function fail(message: string): never {
  throw new AppError('forbidden', message);
}
export async function hashCode(code: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function createOAuthService(options: {
  repository: OAuthRepository;
  upstream: OAuthUpstream;
  verify: VerifyIdentity;
  consentUrl: string;
  workspaces: (ctx: RequestContext) => Promise<Workspace[]>;
}): OAuthService {
  const { repository: db, upstream, verify } = options;
  const member = async (ctx: RequestContext, slug: string) => {
    const w = (await options.workspaces(ctx)).find((w) => w.slug === slug);
    if (!w) fail('Workspace access denied');
    return w;
  };
  async function context(ctx: RequestContext): Promise<Grant> {
    if (ctx.authentication?.kind !== 'oauth') fail('Reconnect and authorize this MCP connection');
    const actor = ctx.authentication;
    const grant = await db.grant(actor.sessionId);
    if (grant.subject !== ctx.identity.subject || grant.clientId !== actor.clientId) {
      fail('Connection authorization mismatch');
    }
    await member(ctx, grant.workspace);
    return grant;
  }
  return {
    context,
    async register(request) {
      const data = await request.clone().json();
      const scope = typeof data.scope === 'string' ? data.scope : 'read write';
      if (scope.split(/\s+/).filter(Boolean).some((s: string) => !['read', 'write'].includes(s))) {
        return Response.json({ error: 'invalid_client_metadata' }, { status: 400 });
      }
      const response = await upstream.register(
        new Request(request, { body: JSON.stringify({ ...data, scope: 'email' }) }),
      );
      if (!response.ok) return response;
      return Response.json({ ...await response.json(), scope }, {
        status: response.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    },
    async authorize(params) {
      const scopes = (params.get('scope') ?? 'read write').split(/\s+/).filter(Boolean);
      if (
        scopes.some((s) => !['read', 'write'].includes(s))
      ) {
        return Response.json({ error: 'invalid_scope' }, { status: 400 });
      }
      const access: Access = scopes.includes('write') || !scopes.includes('read')
        ? 'read_write'
        : 'read';
      const upstreamParams = new URLSearchParams(params);
      upstreamParams.set('scope', 'email');
      const response = await upstream.authorize(upstreamParams);
      const location = response.headers.get('location');
      if (!location) return response;
      const target = new URL(location);
      const consent = new URL(options.consentUrl);
      if (target.origin !== consent.origin || target.pathname !== consent.pathname) return response;
      const id = target.searchParams.get('authorization_id');
      if (!id || !params.get('client_id') || !params.get('redirect_uri')) {
        fail('Invalid upstream authorization');
      }
      await db.saveAuthorization({
        id,
        clientId: params.get('client_id')!,
        redirectUri: params.get('redirect_uri')!,
        state: params.get('state'),
        access,
      });
      return response;
    },
    async details(ctx, id) {
      if (ctx.authentication?.kind === 'oauth') fail('Use your signed-in Roster account');
      return { ...await db.authorization(id), workspaces: await options.workspaces(ctx) };
    },
    async approve(ctx, bearer, id, workspace, access) {
      if (ctx.authentication?.kind === 'oauth') fail('Use your signed-in Roster account');
      await member(ctx, workspace);
      return db.approve(id, async (authorization) => {
        if (access === 'read_write' && authorization.access === 'read') {
          fail('Client requested read-only access');
        }
        // Read upstream details only after the user approves: Supabase may auto-approve
        // a previously authorized client and issue a code from this GET itself.
        const redirect = new URL(await upstream.code(bearer, id));
        const callback = new URL(authorization.redirectUri);
        if (redirect.origin !== callback.origin || redirect.pathname !== callback.pathname) {
          fail('Authorization redirect mismatch');
        }
        const code = redirect.searchParams.get('code');
        if (!code) fail('Authorization did not issue a code');
        return {
          approval: {
            authorizationId: id,
            codeHash: await hashCode(code),
            subject: ctx.identity.subject,
            clientId: authorization.clientId,
            workspace,
            access,
          },
          result: { redirect_url: redirect.href },
        };
      });
    },
    async deny(ctx, id) {
      if (ctx.authentication?.kind === 'oauth') fail('Use your signed-in Roster account');
      const authorization = await db.cancel(id);
      const target = new URL(authorization.redirectUri);
      target.searchParams.set('error', 'access_denied');
      if (authorization.state !== null) target.searchParams.set('state', authorization.state);
      return { redirect_url: target.href };
    },
    async token(request) {
      const form = new URLSearchParams(await request.clone().text());
      const kind = form.get('grant_type');
      if (kind !== 'authorization_code' && kind !== 'refresh_token') {
        return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
      }
      const codeHash = kind === 'authorization_code'
        ? await hashCode(form.get('code') ?? '')
        : undefined;
      const pending = codeHash ? await db.pending(codeHash) : undefined;
      const requestedScope = form.get('scope');
      if (
        requestedScope &&
        requestedScope.split(/\s+/).filter(Boolean).some((s) => !['read', 'write'].includes(s))
      ) {
        return Response.json({ error: 'invalid_scope' }, { status: 400 });
      }
      form.delete('scope');
      const response = await upstream.token(new Request(request, { body: form.toString() }));
      if (!response.ok) return response;
      const data = await response.json();
      if (typeof data.access_token !== 'string') fail('Invalid upstream token response');
      const actor = await verify(
        new Request('https://roster.invalid/token', {
          headers: { Authorization: `Bearer ${data.access_token}` },
        }),
      );
      if (actor.authentication?.kind !== 'oauth') fail('Expected an OAuth access token');
      if (pending) {
        if (
          pending.subject !== actor.identity.subject ||
          pending.clientId !== actor.authentication.clientId
        ) fail('Authorization identity mismatch');
        await db.bind({ ...pending, sessionId: actor.authentication.sessionId }, codeHash!);
      }
      const grant = await context(actor);
      if (
        requestedScope &&
        (requestedScope.split(/\s+/).includes('write') ? 'read_write' : 'read') !== grant.access
      ) {
        return Response.json({
          error: 'invalid_scope',
          error_description: 'Reconnect to change this connection’s access',
        }, { status: 400 });
      }
      return Response.json({ ...data, scope: grant.access === 'read' ? 'read' : 'read write' }, {
        headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
      });
    },
  };
}
