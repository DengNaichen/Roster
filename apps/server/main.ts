import { bootstrap } from '../../packages/backend/src/bootstrap.ts';
import { createJobs } from '../../packages/backend/src/jobs.ts';

const runtime = bootstrap(Deno.env.toObject());
const jobs = createJobs(Deno.env.toObject());
const port = Number(Deno.env.get('PORT') ?? '18471');
const server = Deno.serve({ hostname: '127.0.0.1', port }, (request) => {
  const path = new URL(request.url).pathname;
  if (path === '/webhooks/github') return jobs.webhook(request);
  if (path === '/jobs/run') return jobs.run(request);
  return path.startsWith('/api/') ? runtime.api(request) : runtime.mcp(request);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  Deno.addSignalListener(signal, async () => {
    await server.shutdown();
    await runtime.close();
    await jobs.close();
  });
}
