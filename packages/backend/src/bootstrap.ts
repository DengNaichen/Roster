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
  const app = createHttpApp({ service, verify, allowedOrigins });
  const mcp = createMcpFetch({
    service,
    verify,
    allowedOrigins,
    publicUrl: required(env, 'MCP_PUBLIC_URL'),
    authorizationServer: issuer,
  });
  return { service, api: app.fetch, mcp, close: () => pool.end() };
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
