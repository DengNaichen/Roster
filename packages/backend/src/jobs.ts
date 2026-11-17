import { githubWebhook, parseBindings } from './integrations/github/index.ts';
import { createGitHubIntegration } from './integrations/github/postgres.ts';
import { advanceAllCycles } from './modules/cycles/index.ts';
import { createDatabase } from './platform/database/client.ts';
import { createUnitOfWork } from './platform/database/session.ts';
function equal(a: string, b: string) {
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) mismatch |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return mismatch === 0;
}
export function createJobs(env: Record<string, string | undefined>) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { db, pool } = createDatabase(env.DATABASE_URL, {
    connectionTimeoutMillis: 2000,
    query_timeout: 2500,
  });
  const bindings = parseBindings(env.GITHUB_BINDINGS);
  if ((bindings.length > 0 && env.GITHUB_TOKEN) || env.GITHUB_LINKBACK === 'true') {
    throw new Error('PAT and linkback are no longer supported; configure a read-only GitHub App');
  }
  const github = createGitHubIntegration(db, {
    bindings,
    app: { appId: env.GITHUB_APP_ID ?? '', privateKey: env.GITHUB_APP_PRIVATE_KEY ?? '' },
  });
  return {
    webhook: githubWebhook(github, env.GITHUB_WEBHOOK_SECRET ?? ''),
    async run(request: Request) {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      if (
        !env.JOBS_TOKEN ||
        !equal(request.headers.get('authorization') ?? '', `Bearer ${env.JOBS_TOKEN}`)
      ) return new Response('Unauthorized', { status: 401 });
      try {
        const [cycles, integration] = await Promise.allSettled([
          advanceAllCycles(createUnitOfWork(db)),
          github.run(),
        ]);
        const githubResults = integration.status === 'fulfilled'
          ? integration.value
          : [{ repo: '', error: 'worker_failed' }];
        return Response.json({
          cycles: cycles.status === 'fulfilled' ? 'advanced' : 'failed',
          github: githubResults,
        }, {
          status: cycles.status === 'rejected' || githubResults.some((r) =>
              'error' in r || (r.retried ?? 0) > 0 || (r.dead ?? 0) > 0
            )
            ? 503
            : 200,
        });
      } catch {
        return Response.json({ error: 'Background job failed; retry is safe' }, { status: 503 });
      }
    },
    close: () => pool.end(),
  };
}
