import type { RequestContext, Workspace } from '../../../../contracts/mod.ts';
export type Access = 'read' | 'read_write';
export type Authorization = {
  id: string;
  clientId: string;
  redirectUri: string;
  access: Access;
  state: string | null;
};
export type Grant = {
  sessionId: string;
  subject: string;
  clientId: string;
  workspace: string;
  access: Access;
};
export type Approval = GrantChoice & { codeHash: string; authorizationId: string };
export type GrantChoice = { subject: string; clientId: string; workspace: string; access: Access };
export interface OAuthRepository {
  saveAuthorization(input: Authorization): Promise<void>;
  authorization(id: string): Promise<Authorization>;
  approve<T>(
    id: string,
    run: (authorization: Authorization) => Promise<{ approval: Approval; result: T }>,
  ): Promise<T>;
  cancel(id: string): Promise<Authorization>;
  pending(codeHash: string): Promise<Approval>;
  bind(grant: Grant, codeHash: string): Promise<void>;
  grant(sessionId: string): Promise<Grant>;
}
export interface OAuthUpstream {
  authorize(params: URLSearchParams): Promise<Response>;
  register(request: Request): Promise<Response>;
  code(bearer: string, id: string): Promise<string>;
  token(request: Request): Promise<Response>;
}
export interface OAuthService {
  authorize(params: URLSearchParams): Promise<Response>;
  register(request: Request): Promise<Response>;
  details(ctx: RequestContext, id: string): Promise<Authorization & { workspaces: Workspace[] }>;
  approve(
    ctx: RequestContext,
    bearer: string,
    id: string,
    workspace: string,
    access: Access,
  ): Promise<{ redirect_url: string }>;
  deny(ctx: RequestContext, id: string): Promise<{ redirect_url: string }>;
  token(request: Request): Promise<Response>;
  context(ctx: RequestContext): Promise<Grant>;
}
export { createOAuthService } from './application/service.ts';
export { createOAuthIntegration } from './factory.ts';
