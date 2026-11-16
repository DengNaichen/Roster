// In-page real MCP call with the signed-in user's JWT. No credentials/body in output.
globalThis.rosterMcpProbe = async ({ project, workspace, name, args, region }) => {
  if (!/^[a-z]{20}$/.test(project) || !/^perf-[a-z0-9-]+$/.test(workspace)) {
    throw new Error('Use a test workspace');
  }
  const session = JSON.parse(localStorage.getItem(`sb-${project}-auth-token`) ?? 'null');
  if (!session?.access_token) throw new Error('Sign in first');
  const url = new URL(`https://${project}.supabase.co/functions/v1/mcp/w/${workspace}/mcp`);
  if (region) url.searchParams.set('forceFunctionRegion', region);
  const start = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  const frames = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) =>
      JSON.parse(line.slice(5))
    )
    : [JSON.parse(text)];
  const payload = frames.find((frame) => frame.id === 1);
  if (!response.ok || !payload?.result || payload.result.isError || payload.error) {
    throw new Error(`MCP failed (${response.status})`);
  }
  const result = payload.result.structuredContent?.result;
  if (
    name === 'update_issue' &&
    (!result || result.identifier !== args.identifier ||
      (args.status !== undefined && result.status !== args.status) ||
      (args.priority !== undefined && result.priority !== args.priority))
  ) throw new Error('MCP did not return the requested updated issue');
  return {
    confirmedReturnedFields: name === 'update_issue',
    name,
    status: response.status,
    ms: performance.now() - start,
    bytes: new TextEncoder().encode(text).length,
    region: response.headers.get('x-sb-edge-region'),
    acknowledgedAt: Date.now(),
  };
};
