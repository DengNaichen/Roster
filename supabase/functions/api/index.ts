import { bootstrap, stripFunctionPrefix } from '../../../packages/backend/src/bootstrap.ts';
const runtime = bootstrap(Deno.env.toObject());
Deno.serve((request) => {
  const clean = stripFunctionPrefix(request, 'api');
  const url = new URL(clean.url);
  // Both baseURL=<function URL> and baseURL=<function URL>/api are supported.
  if (!url.pathname.startsWith('/api/')) url.pathname = `/api${url.pathname}`;
  return runtime.api(new Request(url, clean));
});
