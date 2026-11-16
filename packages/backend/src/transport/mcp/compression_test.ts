import { compressMcpResponse } from './compression.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const payload = 'data: ' + JSON.stringify({ text: '中文 gzip test '.repeat(10000) }) + '\n\n';
const reply = (headers: HeadersInit = {}) =>
  new Response(payload, { headers: { 'Content-Type': 'text/event-stream', ...headers } });

Deno.test('MCP gzip negotiation preserves bytes and existing Vary, rejects disabled or invalid coding', async () => {
  for (
    const [encoding, compressed] of [
      ['', false],
      ['br', false],
      ['gzip', true],
      ['GZip; q=0.5', true],
      ['*;q=1', true],
      ['gzip;q=0, *;q=1', false],
      ['gzip;q=0.001', true],
      ['gzip;q=2', false],
      ['gzip;q=bogus', false],
      ['gzip;q=0, gzip', false],
      ['gzip;q=0.5, identity;q=1', false],
      ['gzip;q=1, identity;q=0', true],
    ] as const
  ) {
    const response = compressMcpResponse(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Accept-Encoding': encoding },
      }),
      reply({ Vary: 'Origin', 'Content-Length': String(new TextEncoder().encode(payload).length) }),
    );
    assert(response.headers.get('Vary') === 'Origin, Accept-Encoding');
    assert((response.headers.get('Content-Encoding') === 'gzip') === compressed, encoding);
    const bytes = await response.arrayBuffer();
    if (compressed) {
      assert(!response.headers.has('Content-Length'));
      assert(bytes.byteLength < payload.length / 10);
      const decoded = new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
      );
      assert(await decoded.text() === payload, encoding);
    } else assert(new TextDecoder().decode(bytes) === payload);
  }
});

Deno.test('MCP gzip leaves live GET streams, encoded/range/no-transform and empty/error responses alone', async () => {
  const post = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'Accept-Encoding': 'gzip' },
  });
  for (
    const response of [
      reply({ 'Content-Encoding': 'br' }),
      reply({ 'Content-Range': 'bytes 0-10/100' }),
      reply({ 'Cache-Control': 'no-store, no-transform' }),
      reply({ 'Content-Type': 'image/png' }),
      new Response(null, { status: 204 }),
      new Response('unauthorized', { status: 401 }),
    ]
  ) {
    assert(compressMcpResponse(post, response) === response);
    await response.body?.cancel();
  }
  const stream = reply();
  assert(compressMcpResponse(new Request(post.url, { headers: post.headers }), stream) === stream);
  await stream.body?.cancel();
});

Deno.test('HTTP fetch automatically decompresses MCP gzip and cancellation reaches the upstream', async () => {
  const server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    automaticCompression: false,
    onListen() {},
  }, (request) => compressMcpResponse(request, reply()));
  try {
    const response = await fetch(`http://127.0.0.1:${server.addr.port}/mcp`, {
      method: 'POST',
      headers: { 'Accept-Encoding': 'gzip' },
    });
    assert(response.headers.get('Content-Encoding') === 'gzip');
    // No application decompression: fetch does it before text()/JSON parsing.
    assert(await response.text() === payload);
  } finally {
    await server.shutdown();
  }
  let canceled = false;
  const source = new ReadableStream<Uint8Array>({
    cancel() {
      canceled = true;
    },
  });
  const response = compressMcpResponse(
    new Request('http://localhost/mcp', { method: 'POST', headers: { 'Accept-Encoding': 'gzip' } }),
    new Response(source, { headers: { 'Content-Type': 'text/event-stream' } }),
  );
  await response.body!.cancel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(canceled);
});

Deno.test('JSON responses remain parseable and gzip never hides an upstream stream failure', async () => {
  const request = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'Accept-Encoding': 'gzip' },
  });
  const response = compressMcpResponse(request, Response.json({ result: { text: '你好' } }));
  const decoded = new Response(response.body!.pipeThrough(new DecompressionStream('gzip')));
  assert((await decoded.json()).result.text === '你好');
  const broken = compressMcpResponse(
    request,
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('upstream failed'));
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    ),
  );
  let rejected = false;
  try {
    await broken.arrayBuffer();
  } catch {
    rejected = true;
  }
  assert(rejected);
});
