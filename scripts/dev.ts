import { bootstrap } from '../packages/backend/src/bootstrap.ts';

const runtime = bootstrap(Deno.env.toObject());
const port = Number(Deno.env.get('PORT') ?? '8787');
const server = Deno.serve({ hostname: '127.0.0.1', port }, (request) => {
  const path = new URL(request.url).pathname;
  return path.startsWith('/api/') ? runtime.api(request) : runtime.mcp(request);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  Deno.addSignalListener(signal, async () => {
    await server.shutdown();
    await runtime.close();
  });
}
