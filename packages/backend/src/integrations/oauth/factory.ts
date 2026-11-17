import type { Service } from '../../application/mod.ts';
import type { VerifyIdentity } from '../../platform/auth/jwt.ts';
import type { Database } from '../../platform/database/client.ts';
import { createOAuthService } from './application/service.ts';
import { createOAuthRepository } from './infrastructure/repository.ts';
import { createOAuthUpstream } from './infrastructure/upstream.ts';
export function createOAuthIntegration(
  db: Database,
  service: Service,
  verify: VerifyIdentity,
  issuer: string,
  consentUrl: string,
) {
  return createOAuthService({
    repository: createOAuthRepository(db),
    upstream: createOAuthUpstream(issuer, new URL(consentUrl).origin),
    verify,
    consentUrl,
    workspaces: (ctx) => service.listWorkspaces(ctx),
  });
}
