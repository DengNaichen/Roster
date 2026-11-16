import { act, renderHook, waitFor, createQueryWrapper } from "./test/query-wrapper";
import { beforeEach, expect, it, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import {
  createQueryClient,
  resourceKey,
  ServerCacheProvider,
  ServerCacheBoundary,
  useServerCache,
} from "./queryCache";
import { useResource } from "./useResource";
import { deferred, json } from "./test/fixtures";
import { StrictMode, type ReactNode } from "react";

const path = "/api/w/alpha/issues?query=foo&team=AL";
beforeEach(() => window.history.replaceState(null, "", "/alpha/"));

it("shares canonical keys, deduplicates in-flight reads, and reuses fresh data across remounts", async () => {
  const response = deferred<Response>();
  const fetcher = vi.fn(() => response.promise);
  vi.stubGlobal("fetch", fetcher);
  const wrapper = createQueryWrapper(createQueryClient());
  const first = renderHook(
    () => [useResource(path, ""), useResource("/api/w/alpha/issues?team=AL&query=foo", "")],
    { wrapper },
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => response.resolve(json("cached")));
  await waitFor(() =>
    expect(first.result.current.map((r) => r.data)).toEqual(["cached", "cached"]),
  );
  first.unmount();
  const second = renderHook(() => useResource(path, ""), { wrapper });
  expect(second.result.current.data).toBe("cached");
  expect(second.result.current.loading).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps content during background validation and cancels an old response before a local update", async () => {
  const response = deferred<Response>();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json("confirmed"))
    .mockImplementation(() => response.promise);
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useResource(path, ""));
  await waitFor(() => expect(result.current.data).toBe("confirmed"));
  act(() => {
    void result.current.reload();
  });
  await waitFor(() => expect(result.current.refreshing).toBe(true));
  expect(result.current.loading).toBe(false);
  expect(result.current.data).toBe("confirmed");
  act(() => result.current.update(() => "newer"));
  await act(async () => response.resolve(json("stale")));
  expect(result.current.data).toBe("newer");
});

it("keeps failed background content, purges forbidden/not-found data, and isolates other workspaces", async () => {
  let status = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        status === 200
          ? json("private")
          : json({ error: status === 403 ? "workspace access denied" : "gone" }, status),
      ),
    ),
  );
  const client = createQueryClient(true);
  const wrapper = createQueryWrapper(client);
  const sibling = resourceKey("test-user", "/api/w/alpha/teams");
  const other = resourceKey("test-user", "/api/w/beta/teams");
  client.setQueryData(sibling, "private teams");
  client.setQueryData(other, "other workspace");
  const { result } = renderHook(() => useResource(path, ""), { wrapper });
  await waitFor(() => expect(result.current.data).toBe("private"));
  status = 500;
  await act(async () => result.current.reload());
  expect(result.current.data).toBe("private");
  expect(client.getQueryState(resourceKey("test-user", path))?.status).toBe("error");
  status = 403;
  await act(async () => result.current.reload());
  await waitFor(() => expect(result.current.data).toBe(""));
  expect(client.getQueryData(sibling)).toBeUndefined();
  expect(client.getQueryData(other)).toBe("other workspace");
  status = 200;
  await act(async () => result.current.reload());
  await waitFor(() => expect(result.current.data).toBe("private"));
  status = 404;
  await act(async () => result.current.reload());
  await waitFor(() => expect(result.current.data).toBe(""));
  expect(result.current.error).toBe("gone");
});

it("never shows another subject or workspace's cached result", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url) => Promise.resolve(json(String(url)))),
  );
  const client = createQueryClient(true);
  const otherKey = resourceKey("alice", path);
  client.setQueryData(otherKey, "Alice's private value");
  const wrapper = createQueryWrapper(client, "bob");
  const { result, rerender } = renderHook((url) => useResource(url, "empty"), {
    wrapper,
    initialProps: path,
  });
  expect(result.current.data).toBe("empty");
  await waitFor(() => expect(result.current.data).toBe(path));
  rerender("/api/w/beta/issues");
  expect(result.current.data).toBe("empty");
  await waitFor(() => expect(result.current.data).toBe("/api/w/beta/issues"));
  expect(client.getQueryData(otherKey)).toBe("Alice's private value");
});

it("reports offline cold reads, retains warm data, and fetches after reconnect", async () => {
  const fetcher = vi.fn(() => Promise.resolve(json("online")));
  vi.stubGlobal("fetch", fetcher);
  onlineManager.setOnline(false);
  const { result } = renderHook(() => useResource(path, "empty"));
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toContain("Offline");
  expect(fetcher).not.toHaveBeenCalled();
  act(() => onlineManager.setOnline(true));
  await waitFor(() => expect(result.current.data).toBe("online"));
  act(() => onlineManager.setOnline(false));
  act(() => {
    void result.current.reload();
  });
  expect(result.current.data).toBe("online");
  expect(result.current.loading).toBe(false);
  act(() => onlineManager.setOnline(true));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});

it("pauses reads during same-user session recovery without discarding cached content", async () => {
  const fetcher = vi.fn(() => Promise.resolve(json("draft source")));
  vi.stubGlobal("fetch", fetcher);
  const client = createQueryClient(true);
  let enabled = true;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServerCacheProvider client={client} subject="test-user" enabled={enabled}>
      {children}
    </ServerCacheProvider>
  );
  const { result, rerender, unmount } = renderHook(() => useResource(path, "empty"), { wrapper });
  await waitFor(() => expect(result.current.data).toBe("draft source"));
  enabled = false;
  rerender();
  await act(async () => result.current.reload());
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.current.data).toBe("draft source");
  unmount();
  client.clear();
});

it("survives StrictMode effect replay and clears the client on real unmount", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(json("strict cached"))),
  );
  const { result, unmount } = renderHook(
    () => ({ resource: useResource(path, ""), cache: useServerCache() }),
    {
      wrapper: ({ children }) => (
        <StrictMode>
          <ServerCacheBoundary>{children}</ServerCacheBoundary>
        </StrictMode>
      ),
    },
  );
  await waitFor(() => expect(result.current.resource.data).toBe("strict cached"));
  const client = result.current.cache.scope.client;
  expect(client.getQueryCache().getAll()).toHaveLength(1);
  unmount();
  await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
});

it("restarts an initial read canceled by a write instead of leaving it pending forever", async () => {
  const { useRequestScope } = await import("./useRequestScope");
  const old = deferred<Response>();
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => (++reads === 1 ? old.promise : Promise.resolve(json("after write")))),
  );
  const { result } = renderHook(() => ({
    resource: useResource(path, "empty"),
    writes: useRequestScope(path),
  }));
  expect(reads).toBe(1);
  await act(async () => {
    await result.current.writes.write(
      "AL-1",
      async () => {},
      () => {},
      () => {},
    );
  });
  await waitFor(() => expect(result.current.resource.data).toBe("after write"));
  await act(async () => old.resolve(json("stale")));
  expect(result.current.resource.data).toBe("after write");
});

it("orders one entity across distinct mounted scopes and leaves unrelated entities independent", async () => {
  const { useRequestScope } = await import("./useRequestScope");
  const first = deferred<string>();
  const second = vi.fn(async () => "second");
  const unrelated = vi.fn(async () => "other");
  const { result } = renderHook(() => ({
    list: useRequestScope("/api/w/alpha/issues"),
    detail: useRequestScope("/api/w/alpha/issues/AL-1"),
  }));
  let a: Promise<boolean>, b: Promise<boolean>;
  act(() => {
    a = result.current.list.write(
      "AL-1",
      () => first.promise,
      () => {},
      () => {},
    );
    b = result.current.detail.write(
      "AL-1",
      second,
      () => {},
      () => {},
    );
  });
  await act(async () => {
    await result.current.detail.write(
      "AL-2",
      unrelated,
      () => {},
      () => {},
    );
  });
  expect(second).not.toHaveBeenCalled();
  expect(unrelated).toHaveBeenCalledOnce();
  await act(async () => {
    first.resolve("first");
    await Promise.all([a, b]);
  });
  expect(second).toHaveBeenCalledOnce();
});

it("discards unconfirmed cached edits on disposal, even when the sent write later fails", async () => {
  const { useRequestScope } = await import("./useRequestScope");
  const pending = deferred<string>();
  const send = vi.fn(() => pending.promise);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(json("confirmed"))),
  );
  const client = createQueryClient(true);
  const wrapper = createQueryWrapper(client);
  const { result, unmount } = renderHook(
    () => ({ resource: useResource(path, ""), writes: useRequestScope(path) }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.resource.data).toBe("confirmed"));
  let operation: Promise<boolean>;
  act(() => {
    result.current.resource.update(() => "unconfirmed");
    operation = result.current.writes.write(
      "AL-1",
      send,
      () => {},
      () => {},
    );
  });
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  unmount();
  await act(async () => {
    pending.reject(new Error("failed after navigation"));
    await operation;
  });
  expect(client.getQueryData(resourceKey("test-user", path))).not.toBe("unconfirmed");
});

it("never invents a partial cached object when an update races a permission purge", () => {
  const client = createQueryClient(true);
  const wrapper = createQueryWrapper(client);
  onlineManager.setOnline(false);
  const { result } = renderHook(
    () => useResource<{ title: string; body: string } | null>(path, null),
    { wrapper },
  );
  act(() => result.current.update(() => ({ title: "partial", body: "" })));
  expect(client.getQueryData(resourceKey("test-user", path))).toBeUndefined();
});

it("retains readable parent data when a sub-resource write is rejected", async () => {
  const { api } = await import("./shared");
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, options) =>
      Promise.resolve(
        options?.method === "PATCH"
          ? json({ error: "Acceptance criterion AC-2 not found" }, 404)
          : json("readable parent"),
      ),
    ),
  );
  const resourcePath = "/api/w/alpha/issues/AL-1";
  const { result } = renderHook(() => useResource(resourcePath, "empty"));
  await waitFor(() => expect(result.current.data).toBe("readable parent"));
  await act(async () => {
    await expect(api(`${resourcePath}/criteria/AC-2`, "PATCH", { done: true })).rejects.toThrow(
      "Acceptance criterion",
    );
  });
  expect(result.current.data).toBe("readable parent");
  expect(result.current.error).toBe("");
});
