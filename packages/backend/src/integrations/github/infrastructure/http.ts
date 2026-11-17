import { importPKCS8, SignJWT } from 'npm:jose@6.1.3';
import { z } from 'zod';
import { type GitHubClient, GitHubError } from '../application/client.ts';
import { type GitHubBinding, pullSchema } from '../application/model.ts';

export interface AppCredentials {
  appId: string;
  privateKey: string;
}
const tokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true }),
});
const repositorySchema = z.object({ id: z.number().int().positive(), full_name: z.string() });
/** Wrap a PKCS#1 RSA DER key in PKCS#8 using only WebCrypto-compatible bytes. */
function normalizePrivateKey(pem: string): string {
  if (!pem.includes('-----BEGIN RSA PRIVATE KEY-----')) return pem;
  const rsa = Uint8Array.from(
    atob(pem.replace(/-----[A-Z ]+-----|\s/g, '')),
    (c) => c.charCodeAt(0),
  );
  const concat = (...parts: Uint8Array[]) => {
    const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      result.set(p, offset);
      offset += p.length;
    }
    return result;
  };
  const der = (tag: number, value: Uint8Array) => {
    let length = value.length;
    const bytes: number[] = [];
    do {
      bytes.unshift(length & 255);
      length >>>= 8;
    } while (length);
    return concat(
      new Uint8Array([
        tag,
        ...(value.length < 128 ? [value.length] : [128 + bytes.length, ...bytes]),
      ]),
      value,
    );
  };
  const algorithm = new Uint8Array([48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0]);
  const pkcs8 = der(48, concat(new Uint8Array([2, 1, 0]), algorithm, der(4, rsa)));
  const encoded = btoa(String.fromCharCode(...pkcs8));
  return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`;
}
/** Secrets and tokens stay within this adapter; tokens are restricted to one repository. */
export function createGitHubClient(options: {
  app: AppCredentials;
  fetch?: typeof fetch;
  now?: () => number;
}): GitHubClient {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let signingKey: Promise<CryptoKey> | undefined;
  const tokens = new Map<string, { token: string; expiresAt: number }>();
  const refreshing = new Map<string, Promise<string>>();
  async function request(path: string, token: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await send(`https://api.github.com${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2026-03-10',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new GitHubError('network');
    }
    if (!response.ok) {
      const after = response.headers.get('retry-after');
      const seconds = after === null ? NaN : Number(after);
      const retryAfter = Number.isFinite(seconds)
        ? now() + seconds * 1000
        : Date.parse(after ?? '');
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      const limited = response.status === 429 || (response.status === 403 &&
        (after !== null || response.headers.get('x-ratelimit-remaining') === '0'));
      throw new GitHubError(
        limited ? 'rate_limited' : `http_${response.status}`,
        limited
          ? Math.max(now() + 60_000, Number.isFinite(retryAfter) ? retryAfter : 0, reset)
          : null,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new GitHubError('invalid_response');
    }
  }
  async function mint(b: GitHubBinding): Promise<string> {
    signingKey ??= importPKCS8(normalizePrivateKey(options.app.privateKey), 'RS256');
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(options.app.appId)
      .setIssuedAt(Math.floor(now() / 1000) - 60)
      .setExpirationTime(Math.floor(now() / 1000) + 540)
      .sign(await signingKey);
    const parsed = tokenSchema.safeParse(
      await request(
        `/app/installations/${b.installationId}/access_tokens`,
        jwt,
        {
          repository_ids: [b.repositoryId],
          permissions: { metadata: 'read', pull_requests: 'read' },
        },
      ),
    );
    if (!parsed.success || Date.parse(parsed.data.expires_at) <= now() + 60_000) {
      throw new GitHubError('invalid_token_response');
    }
    tokens.set(`${b.installationId}:${b.repositoryId}`, {
      token: parsed.data.token,
      expiresAt: Date.parse(parsed.data.expires_at),
    });
    return parsed.data.token;
  }
  async function token(b: GitHubBinding): Promise<string> {
    const key = `${b.installationId}:${b.repositoryId}`;
    const cached = tokens.get(key);
    if (cached && cached.expiresAt > now() + 60_000) return cached.token;
    let pending = refreshing.get(key);
    if (!pending) {
      pending = mint(b).finally(() => refreshing.delete(key));
      refreshing.set(key, pending);
    }
    return await pending;
  }
  async function get(b: GitHubBinding, path: string): Promise<unknown> {
    try {
      return await request(path, await token(b));
    } catch (error) {
      if (!(error instanceof GitHubError) || error.code !== 'http_401') throw error;
      tokens.delete(`${b.installationId}:${b.repositoryId}`);
      return await request(path, await token(b));
    }
  }
  function parsePull(value: unknown, b: GitHubBinding) {
    const parsed = pullSchema.safeParse(value);
    if (!parsed.success || parsed.data.base.repo.id !== b.repositoryId) {
      throw new GitHubError('invalid_pull_response');
    }
    return parsed.data;
  }
  return {
    async verify(b) {
      const result = repositorySchema.safeParse(await get(b, `/repos/${b.repo}`));
      if (
        !result.success || result.data.id !== b.repositoryId ||
        result.data.full_name.toLowerCase() !== b.repo.toLowerCase()
      ) {
        throw new GitHubError('repository_mismatch');
      }
    },
    async pull(b, number) {
      const p = parsePull(await get(b, `/repos/${b.repo}/pulls/${number}`), b);
      if (p.number !== number) throw new GitHubError('pull_number_mismatch');
      return p;
    },
    async pulls(b, page) {
      const data = await get(
        b,
        `/repos/${b.repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
      );
      if (!Array.isArray(data) || data.length > 100) throw new GitHubError('invalid_pull_response');
      return data.map((p) => parsePull(p, b));
    },
  };
}
