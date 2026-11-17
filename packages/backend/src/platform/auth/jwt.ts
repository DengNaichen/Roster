import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'npm:jose@6.1.3';
import { AppError, type RequestContext } from '../../../../contracts/mod.ts';
export type VerifyIdentity = (request: Request) => Promise<RequestContext>;
export interface AuthConfig {
  issuer: string;
  audience: string | string[];
  jwks?: JWTVerifyGetKey;
}
export function createIdentityVerifier(config: AuthConfig): VerifyIdentity {
  const issuer = config.issuer.replace(/\/$/, '');
  const keys = config.jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (request) => {
    const match = /^Bearer ([^\s,]+)$/i.exec(request.headers.get('authorization') ?? '');
    if (!match) throw new AppError('unauthenticated', 'A user access token is required');
    try {
      const { payload } = await jwtVerify(match[1], keys, {
        issuer,
        audience: config.audience,
        algorithms: ['ES256', 'RS256'],
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      if (!payload.sub || payload.role !== 'authenticated' || payload.is_anonymous === true) {
        throw new Error('User access token required');
      }
      const oauth = Object.hasOwn(payload, 'client_id');
      if (
        oauth && (typeof payload.client_id !== 'string' || typeof payload.session_id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            payload.client_id,
          ) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            payload.session_id,
          ))
      ) {
        throw new Error('Invalid OAuth identity');
      }
      return {
        authentication: oauth
          ? {
            kind: 'oauth',
            clientId: payload.client_id as string,
            sessionId: payload.session_id as string,
          }
          : { kind: 'user' },
        identity: {
          subject: payload.sub,
          email: typeof payload.email === 'string' ? payload.email : '',
          name: typeof payload.user_metadata === 'object' && payload.user_metadata !== null &&
              'name' in payload.user_metadata && typeof payload.user_metadata.name === 'string'
            ? payload.user_metadata.name
            : '',
        },
      };
    } catch {
      throw new AppError('unauthenticated', 'Invalid or expired user access token');
    }
  };
}
