import { createOAuthIntegration } from './integrations/oauth/index.ts';
import { createOAuthTransport } from './transport/oauth/server.ts';
import { measureRequest } from './platform/telemetry/performance.ts';
import { createIdentityVerifier } from './platform/auth/jwt.ts';
import { createDatabase } from './platform/database/client.ts';
import { createService } from './service.ts';
import { createHttpApp } from './transport/http/app.ts';
import { createMcpFetch } from './transport/mcp/server.ts';
export type Environment = Record<string, string | undefined>;
function required(env: Environment, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}
export function bootstrap(env: Environment) {
  const { db, pool } = createDatabase(required(env, 'DATABASE_URL'));
  const issuer = `${required(env, 'SUPABASE_URL').replace(/\/$/, '')}/auth/v1`;
  // Supabase's default OAuth access-token audience is "authenticated". A custom
  // access-token hook can bind a deployment-specific audience through this value.
  const audience = env.AUTH_AUDIENCE?.split(',').map((s) => s.trim()).filter(Boolean) ??
    ['authenticated'];
  const allowedOrigins = required(env, 'ALLOWED_ORIGINS').split(',').map((s) =>
    new URL(s.trim()).origin
  );
  const verify = createIdentityVerifier({ issuer, audience });
  const service = createService(db);
  const publicUrl = required(env, 'MCP_PUBLIC_URL').replace(/\/$/, '');
  const consentUrl = env.OAUTH_CONSENT_URL ?? `${allowedOrigins[0]}/oauth/consent`;
  const oauthPublicUrl = env.OAUTH_PUBLIC_URL ?? new URL(consentUrl).origin;
  const oauth = createOAuthIntegration(db, service, verify, issuer, consentUrl);
  const oauthFetch = createOAuthTransport({
    oauth,
    verify,
    publicUrl: oauthPublicUrl,
    resourceUrl: publicUrl,
    allowedOrigins,
  });
  const app = createHttpApp({ service, verify, allowedOrigins });
  const mcp = createMcpFetch({
    service,
    verify,
    allowedOrigins,
    publicUrl,
    authorizationServer: oauthPublicUrl,
    authorize: (ctx) => oauth.context(ctx),
  });
  const measured =
    (run: (request: Request) => Response | Promise<Response>) => (request: Request) =>
      env.ROSTER_PERFORMANCE === 'true' ? measureRequest(() => run(request)) : run(request);
  return {
    service,
    api: measured((request) =>
      new URL(request.url).pathname.startsWith('/api/oauth/')
        ? oauthFetch(request)
        : app.fetch(request)
    ),
    mcp: measured((request) => {
      const path = new URL(request.url).pathname;
      return path.startsWith('/oauth/') || path === '/.well-known/oauth-authorization-server'
        ? oauthFetch(request)
        : mcp(request);
    }),
    close: () => pool.end(),
  };
}
/** Edge gateways retain the function name in URL.pathname; adapters use clean paths. */
export function stripFunctionPrefix(request: Request, functionName: string): Request {
  const url = new URL(request.url);
  for (const prefix of [`/functions/v1/${functionName}`, `/${functionName}`]) {
    if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
      url.pathname = url.pathname.slice(prefix.length) || '/';
      break;
    }
  }
  return new Request(url, request);
}
