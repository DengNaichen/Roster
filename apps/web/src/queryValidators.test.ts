import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.unmock("./integration");
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_LOCAL_PREVIEW", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("associates a validator with confirmed cache identity, never a local change or another owner", async () => {
  const { createQueryClient, createCacheScope, resourceOptions } = await import("./queryCache");
  const client = createQueryClient(true);
  const path = "/api/w/alpha/issues/AL-1";
  const scope = createCacheScope(client, "owner");
  const options = resourceOptions<{ title: string }>(scope, path);
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ title: "server" }), { headers: { ETag: 'W/"one"' } }),
    );
  vi.stubGlobal("fetch", fetcher);
  await client.fetchQuery(options);
  fetcher.mockImplementation(
    async () => new Response(null, { status: 304, headers: { ETag: 'W/"one"' } }),
  );
  expect(await client.fetchQuery(options)).toMatchObject({ title: "server" });
  expect(fetcher.mock.calls.at(-1)![1].headers.get("If-None-Match")).toBe('W/"one"');
  client.setQueryData(options.queryKey, { title: "optimistic" });
  fetcher.mockImplementation(
    async () =>
      new Response(JSON.stringify({ title: "new server" }), { headers: { ETag: 'W/"two"' } }),
  );
  await client.fetchQuery(options);
  expect(fetcher.mock.calls.at(-1)![1].headers.has("If-None-Match")).toBe(false);
  await client.fetchQuery(resourceOptions(createCacheScope(client, "other"), path));
  expect(fetcher.mock.calls.at(-1)![1].headers.has("If-None-Match")).toBe(false);
  client.clear();
});
it("does not let a canceled response certify a subsequent local edit", async () => {
  const { createQueryClient, createCacheScope, resourceOptions } = await import("./queryCache");
  const client = createQueryClient(true);
  const options = resourceOptions(createCacheScope(client, "owner"), "/api/w/alpha/issues/AL-1");
  let deliver: (r: Response) => void = () => {};
  const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((r) => (deliver = r)));
  vi.stubGlobal("fetch", fetcher);
  const old = client.fetchQuery(options).catch(() => {});
  await client.cancelQueries({ queryKey: options.queryKey });
  client.setQueryData(options.queryKey, { title: "local" });
  deliver(new Response(JSON.stringify({ title: "late" }), { headers: { ETag: 'W/"late"' } }));
  await old;
  fetcher.mockImplementation(
    async () =>
      new Response(JSON.stringify({ title: "confirmed" }), { headers: { ETag: 'W/"new"' } }),
  );
  await client.fetchQuery(options);
  expect(fetcher.mock.calls.at(-1)![1].headers.has("If-None-Match")).toBe(false);
  expect(client.getQueryData(options.queryKey)).toMatchObject({ title: "confirmed" });
  client.clear();
});

it("does not use or record a path neighbor validator when no executing query key is provided", async () => {
  const { createQueryClient, createCacheScope, resourceOptions, fetchResource } = await import(
    "./queryCache"
  );
  const client = createQueryClient(true);
  const scope = createCacheScope(client, "owner");
  const path = "/api/w/alpha/issues/AL-1/work-logs?before=0";
  const options = resourceOptions(scope, path);
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ value: "first" }), { headers: { ETag: 'W/"first"' } }),
    );
  vi.stubGlobal("fetch", fetcher);
  await client.fetchQuery(options);
  fetcher.mockImplementation(
    async () =>
      new Response(JSON.stringify({ value: "separate shape" }), {
        headers: { ETag: 'W/"second"' },
      }),
  );
  await fetchResource(scope, path, new AbortController().signal);
  expect(fetcher.mock.calls.at(-1)![1].headers.has("If-None-Match")).toBe(false);
  fetcher.mockImplementation(
    async () => new Response(null, { status: 304, headers: { ETag: 'W/"first"' } }),
  );
  expect(await client.fetchQuery(options)).toEqual({ value: "first" });
  expect(fetcher.mock.calls.at(-1)![1].headers.get("If-None-Match")).toBe('W/"first"');
  client.clear();
});
