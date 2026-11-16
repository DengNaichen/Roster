import { match as assertMatch, strictEqual as assertEquals } from 'node:assert';
import { measureQuery, measureRequest } from './performance.ts';

Deno.test('Performance counters isolate concurrent requests and count failed SQL without values', async () => {
  const [first, second] = await Promise.all([
    measureRequest(async () => {
      await measureQuery(() => Promise.resolve('private value'));
      try {
        await measureQuery(() => Promise.reject(new Error('private SQL')));
      } catch { /* measured */ }
      return new Response('ok');
    }),
    measureRequest(async () => {
      await measureQuery(() => Promise.resolve(42));
      return new Response('other');
    }),
  ]);
  assertEquals(first.headers.get('X-Roster-Sql-Count'), '2');
  assertEquals(second.headers.get('X-Roster-Sql-Count'), '1');
  assertMatch(first.headers.get('Server-Timing')!, /^app;dur=\d+\.\d+, sql;dur=\d+\.\d+$/);
  assertEquals(await first.text(), 'ok');
  assertEquals(await second.text(), 'other');
});

Deno.test('Performance diagnostics omit errors and streaming responses and preserve cache policy', async () => {
  for (
    const response of [
      new Response('denied', { status: 403 }),
      new Response('data: private', { headers: { 'Content-Type': 'text/event-stream' } }),
    ]
  ) {
    const measured = await measureRequest(async () => {
      await measureQuery(() => Promise.resolve());
      return response;
    });
    assertEquals(measured.headers.has('X-Roster-Sql-Count'), false);
    await measured.body?.cancel();
  }
  const response = await measureRequest(() =>
    new Response('ok', { headers: { 'Cache-Control': 'private, max-age=0' } })
  );
  assertEquals(response.headers.get('Cache-Control'), 'private, max-age=0');
  await response.body?.cancel();
});

Deno.test('Nested measured executor adapters count each application execution once', async () => {
  const { measuredExecutor } = await import('../database/query.ts');
  const { sql } = await import('npm:drizzle-orm@0.45.4');
  let executions = 0;
  const executor = measuredExecutor({
    execute: () => {
      executions++;
      return Promise.resolve({ rows: [] });
    },
  });
  const nested = measuredExecutor(executor);
  const response = await measureRequest(async () => {
    await nested.execute(sql`select 1`);
    return new Response('ok');
  });
  assertEquals(executions, 1);
  assertEquals(response.headers.get('X-Roster-Sql-Count'), '1');
  await response.body?.cancel();
});
