import { bootstrap, stripFunctionPrefix } from '../../../packages/backend/src/bootstrap.ts';
const runtime = bootstrap(Deno.env.toObject());
Deno.serve((request) => runtime.mcp(stripFunctionPrefix(request, 'mcp')));
