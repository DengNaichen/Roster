// Only compress finite POST replies. GET notification streams must not acquire
// gzip buffering, and discovery/authentication responses stay untouched.
export function compressMcpResponse(request: Request, response: Response): Response {
  const type = response.headers.get('content-type')?.split(';')[0].trim();
  if (
    request.method !== 'POST' || response.status !== 200 || !response.body ||
    (type !== 'application/json' && type !== 'text/event-stream') ||
    response.headers.has('content-encoding') || response.headers.has('content-range') ||
    /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(response.headers.get('cache-control') ?? '')
  ) return response;

  const headers = new Headers(response.headers);
  const vary = headers.get('vary');
  if (
    !vary?.split(',').some((value) => ['*', 'accept-encoding'].includes(value.trim().toLowerCase()))
  ) {
    headers.set('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  }
  if (!acceptsGzip(request.headers.get('accept-encoding'))) {
    return new Response(response.body, { status: response.status, headers });
  }
  headers.set('Content-Encoding', 'gzip');
  headers.delete('Content-Length');
  return new Response(response.body.pipeThrough(new CompressionStream('gzip')), {
    status: response.status,
    headers,
  });
}

function acceptsGzip(value: string | null): boolean {
  if (!value) return false;
  const weights = new Map<string, number>();
  for (const entry of value.split(',')) {
    const [coding, ...parameters] = entry.trim().toLowerCase().split(';');
    const name = coding.trim();
    const parameter = parameters.join(';').trim();
    const match = /^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.exec(parameter);
    const weight = parameter ? (match ? Number(match[1]) : 0) : 1;
    // Ambiguous duplicate entries fail closed, especially gzip;q=0.
    weights.set(name, Math.min(weights.get(name) ?? 1, weight));
  }
  const gzip = weights.get('gzip') ?? weights.get('*') ?? 0;
  return gzip > 0 && gzip >= (weights.get('identity') ?? 0);
}
