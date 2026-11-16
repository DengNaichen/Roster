import type { MiddlewareHandler } from 'npm:hono@4.11.4';

// Validators save response bytes, not authorization or database work. Never cache a denial.
export const conditionalRead: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.method !== 'GET' || c.res.status !== 200) return;
  const digest = await crypto.subtle.digest('SHA-256', await c.res.clone().arrayBuffer());
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const tag = `W/"${hash}"`;
  c.res.headers.set('ETag', tag);
  // The application cache owns user/workspace isolation; do not persist authenticated bodies in HTTP caches.
  c.res.headers.set('Cache-Control', 'no-store');
  const matches = c.req.header('If-None-Match')?.split(',').some((candidate) =>
    candidate.trim().replace(/^W\//, '') === tag.slice(2)
  );
  if (matches) {
    const headers = new Headers(c.res.headers);
    headers.delete('Content-Length');
    headers.delete('Content-Type');
    headers.delete('Content-Encoding');
    c.res = new Response(null, { status: 304, headers });
  }
};
