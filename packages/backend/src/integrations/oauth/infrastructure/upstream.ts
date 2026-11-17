import { AppError } from '../../../../../contracts/mod.ts';
import type { OAuthUpstream } from '../index.ts';
export function createOAuthUpstream(
  issuer: string,
  origin: string,
  fetcher: typeof fetch = fetch,
): OAuthUpstream {
  const call = (path: string, init: RequestInit = {}) =>
    fetcher(`${issuer}${path}`, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
  const relay = (path: string, request: Request) => {
    const headers = new Headers();
    for (const name of ['authorization', 'content-type']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    return call(
      path,
      { method: 'POST', headers, body: request.body, duplex: 'half' } as RequestInit,
    );
  };
  return {
    authorize: (params) => call(`/oauth/authorize?${params}`),
    register: (request) => relay('/oauth/clients/register', request),
    token: (request) => relay('/oauth/token', request),
    async code(bearer, id) {
      const headers = { Authorization: bearer, Origin: origin, 'Content-Type': 'application/json' };
      const details = await call(`/oauth/authorizations/${encodeURIComponent(id)}`, { headers });
      if (!details.ok) {
        throw new AppError(
          'invalid_input',
          'Authorization expired or unavailable; start the connection again',
        );
      }
      const data = await details.json();
      if (typeof data.redirect_url === 'string') return data.redirect_url;
      const consent = await call(`/oauth/authorizations/${encodeURIComponent(id)}/consent`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'approve' }),
      });
      if (!consent.ok) {
        throw new AppError(
          'invalid_input',
          'Authorization could not be approved; start the connection again',
        );
      }
      const result = await consent.json();
      if (typeof result.redirect_url !== 'string') {
        throw new AppError('invalid_input', 'Missing authorization redirect');
      }
      return result.redirect_url;
    },
  };
}
