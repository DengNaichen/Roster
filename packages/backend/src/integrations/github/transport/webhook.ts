import type { createGitHubSync } from '../application/sync.ts';
export function githubWebhook(
  sync: Pick<ReturnType<typeof createGitHubSync>, 'notify'>,
  secret: string,
) {
  return async (request: Request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 1_048_576) {
          await reader.cancel();
          return new Response('Payload too large', { status: 413 });
        }
        chunks.push(part.value);
      }
    }
    const bytes = new Uint8Array(length);
    let pos = 0;
    for (const part of chunks) {
      bytes.set(part, pos);
      pos += part.length;
    }
    const signature = request.headers.get('x-hub-signature-256') ?? '';
    if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
      return new Response('Invalid signature', { status: 401 });
    }
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sig = Uint8Array.from(signature.slice(7).match(/../g)!, (h) => parseInt(h, 16));
    if (!await crypto.subtle.verify('HMAC', key, sig, bytes)) {
      return new Response('Invalid signature', { status: 401 });
    }
    if (request.headers.get('x-github-event') !== 'pull_request') {
      return new Response(null, { status: 204 });
    }
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return new Response('Invalid payload', { status: 400 });
    }
    if (typeof payload?.repository?.full_name !== 'string') {
      return new Response('Invalid repository', { status: 400 });
    }
    return new Response(null, {
      status: await sync.notify(payload.repository.full_name) ? 202 : 204,
    });
  };
}
