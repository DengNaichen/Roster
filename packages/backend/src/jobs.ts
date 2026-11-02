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
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const github = createGitHubIntegration(db, {
    bindings: parseBindings(env.GITHUB_BINDINGS),
    token: env.GITHUB_TOKEN ?? '',
    linkback: env.GITHUB_LINKBACK === 'true',
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
        await advanceAllCycles(createUnitOfWork(db));
        const githubResults = await github.run();
        return Response.json({ cycles: 'advanced', github: githubResults }, {
          status: githubResults.some((r) => 'error' in r) ? 503 : 200,
        });
      } catch {
        return Response.json({ error: 'Background job failed; retry is safe' }, { status: 503 });
      }
    },
    close: () => pool.end(),
  };
}
