import { writeFilter } from "./issueCache";
import { writeStarted, writeFinished } from "./integration/cache-events";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
  type Query,
  type QueryKey,
} from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useSession } from "./integration/auth";
import { api } from "./shared";

export const workspaceScope = (path: string) => /^\/api\/w\/([^/?]+)/.exec(path)?.[1] ?? null;
export function canonicalPath(path: string) {
  if (!path) return path;
  const url = new URL(path, "http://roster.local");
  const params = [...url.searchParams].sort(
    ([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv),
  );
  const query = new URLSearchParams(params).toString();
  return url.pathname + (query ? `?${query}` : "");
}
export const resourceKey = (subject: string, path: string) =>
  ["resource", subject, workspaceScope(path), canonicalPath(path)] as const;
export function statusOf(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;
}
const belongs = (query: Query, subject: string, workspace: string | null) =>
  query.queryKey[0] === "resource" &&
  query.queryKey[1] === subject &&
  query.queryKey[2] === workspace;

function purgeRejected(cache: QueryCache, key: QueryKey, error: unknown) {
  const status = statusOf(error);
  if (status !== 403 && status !== 404) return;
  const workspaceDenied =
    status === 403 &&
    error instanceof Error &&
    error.message.toLowerCase() === "workspace access denied";
  for (const query of cache.getAll()) {
    if (
      query.queryKey[0] !== "resource" ||
      query.queryKey[1] !== key[1] ||
      query.queryKey[2] !== key[2]
    )
      continue;
    if (!workspaceDenied && query.queryKey[3] !== key[3]) continue;
    void query.cancel({ silent: true });
    query.setState({
      data: undefined,
      dataUpdatedAt: 0,
      status: "error",
      error: error instanceof Error ? error : new Error("Access denied"),
      fetchStatus: "idle",
      isInvalidated: true,
    });
  }
}

export function createQueryClient(test = false) {
  const cache = new QueryCache({
    onError: (error, query) => purgeRejected(cache, query.queryKey, error),
  });
  return new QueryClient({
    queryCache: cache,
    defaultOptions: {
      queries: {
        staleTime: test ? 0 : 30_000,
        gcTime: 300_000,
        retry: (count, error) =>
          !test &&
          count < 1 &&
          error.name !== "AbortError" &&
          ![401, 403, 404].includes(statusOf(error) ?? 0),
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: false, networkMode: "always" },
    },
  });
}

// Keep the existing focus event behavior as well as the browser visibility lifecycle.
focusManager.setEventListener((notify) => {
  const focus = () => notify();
  window.addEventListener("focus", focus);
  window.addEventListener("visibilitychange", focus);
  return () => {
    window.removeEventListener("focus", focus);
    window.removeEventListener("visibilitychange", focus);
  };
});

export function createCacheScope(client: QueryClient, subject: string) {
  const pending = new Map<string | null, number>();
  const queues = new Map<string, Promise<unknown>>();
  const waiters = new Map<string | null, Set<() => void>>();
  const filter = (path: string, properties = false) => ({
    predicate: writeFilter(subject, path, client, properties),
  });
  const confirmations = new Set<(path: string, value: unknown) => void>();
  return {
    client,
    subject,
    onConfirmed(listener: (path: string, value: unknown) => void) {
      confirmations.add(listener);
      return () => confirmations.delete(listener);
    },
    confirm(path: string, value: unknown) {
      confirmations.forEach((listener) => listener(path, value));
    },
    reject(path: string, error: unknown) {
      // A forbidden write or missing sub-resource need not deny reading the parent.
      // Only explicit workspace denial proves access loss; otherwise the ensuing GET decides.
      if (
        statusOf(error) === 403 &&
        error instanceof Error &&
        error.message.toLowerCase() === "workspace access denied"
      )
        purgeRejected(client.getQueryCache(), resourceKey(subject, path), error);
    },
    discard(path: string) {
      void client.resetQueries({ queryKey: resourceKey(subject, path), exact: true });
    },
    async enqueue<T>(path: string, entities: string[], run: () => Promise<T>) {
      const keys = entities.map((entity) => JSON.stringify([workspaceScope(path), entity]));
      const operation = Promise.all(keys.map((key) => queues.get(key)?.catch(() => {}))).then(run);
      keys.forEach((key) => queues.set(key, operation));
      try {
        return await operation;
      } finally {
        keys.forEach((key) => {
          if (queues.get(key) === operation) queues.delete(key);
        });
      }
    },
    invalidate(path: string, active = false) {
      return client.invalidateQueries({ ...filter(path), refetchType: active ? "active" : "none" });
    },
    beginWrite(path: string, options: { invalidate?: boolean; properties?: boolean } = {}) {
      const workspace = workspaceScope(path);
      const count = pending.get(workspace) ?? 0;
      pending.set(workspace, count + 1);
      const affected = filter(path, options.properties);
      const interrupted = client
        .getQueryCache()
        .findAll(affected)
        .filter((query) => query.state.fetchStatus !== "idle")
        .map((query) => ({ query, state: query.state }));
      // Each newly queued write must cancel its own affected old reads, even when another entity is pending.
      void client.cancelQueries(affected);
      interrupted.forEach(({ query, state }) =>
        query.setState({ ...state, fetchStatus: "idle", isInvalidated: true }),
      );
      if (options.invalidate !== false)
        void client.invalidateQueries({ ...affected, refetchType: "none" });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = (pending.get(workspace) ?? 1) - 1;
        if (count) pending.set(workspace, count);
        else {
          pending.delete(workspace);
          const ready = waiters.get(workspace);
          waiters.delete(workspace);
          ready?.forEach((resolve) => resolve());
          // Cancellation must defer an initial/refresh read, never leave it idle forever.
          void client.refetchQueries(
            {
              predicate: (query) => belongs(query, subject, workspace) && query.state.isInvalidated,
              type: "active",
            },
            { cancelRefetch: false },
          );
        }
      };
    },
    hasPending(path: string) {
      return Boolean(pending.get(workspaceScope(path)));
    },
    async wait(path: string, signal: AbortSignal) {
      signal.throwIfAborted();
      const workspace = workspaceScope(path);
      if (!pending.get(workspace)) return;
      await new Promise<void>((resolve, reject) => {
        const group = waiters.get(workspace) ?? new Set<() => void>();
        const ready = () => {
          signal.removeEventListener("abort", abort);
          group.delete(ready);
          resolve();
        };
        const abort = () => {
          group.delete(ready);
          reject(signal.reason);
        };
        group.add(ready);
        waiters.set(workspace, group);
        signal.addEventListener("abort", abort, { once: true });
      });
    },
  };
}
export type CacheScope = ReturnType<typeof createCacheScope>;
const scopes = new WeakMap<QueryClient, Map<string, CacheScope>>();
function scopeFor(client: QueryClient, subject: string) {
  const owners = scopes.get(client) ?? new Map<string, CacheScope>();
  const scope = owners.get(subject) ?? createCacheScope(client, subject);
  owners.set(subject, scope);
  scopes.set(client, owners);
  return scope;
}
const Context = createContext<{ scope: CacheScope; enabled: boolean } | null>(null);
export function useServerCache() {
  const value = useContext(Context);
  if (!value) throw new Error("Server cache provider is required");
  return value;
}
export function ServerCacheProvider({
  client,
  subject,
  enabled = true,
  children,
}: {
  client: QueryClient;
  subject: string;
  enabled?: boolean;
  children: ReactNode;
}) {
  const scope = useMemo(() => scopeFor(client, subject), [client, subject]);
  const value = useMemo(() => ({ scope, enabled }), [scope, enabled]);
  useEffect(() => {
    const releases = new Map<symbol, () => void>();
    const started = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        typeof event.detail?.path === "string" &&
        typeof event.detail.id === "symbol"
      )
        releases.set(event.detail.id, scope.beginWrite(event.detail.path));
    };
    const finished = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail?.id === "symbol") {
        if (typeof event.detail.path === "string" && event.detail.error)
          scope.reject(event.detail.path, event.detail.error);
        releases.get(event.detail.id)?.();
        releases.delete(event.detail.id);
      }
    };
    window.addEventListener(writeStarted, started);
    window.addEventListener(writeFinished, finished);
    return () => {
      window.removeEventListener(writeStarted, started);
      window.removeEventListener(writeFinished, finished);
      releases.forEach((release) => release());
    };
  }, [scope]);
  return (
    <QueryClientProvider client={client}>
      <Context.Provider value={value}>{children}</Context.Provider>
    </QueryClientProvider>
  );
}
export function ServerCacheBoundary({ children }: { children: ReactNode }) {
  const { identity, needsLogin } = useSession();
  // AuthBoundary preserves the same user's drafts during temporary expiry, and unmounts on logout.
  const owner = useRef(identity?.subject ?? "anonymous");
  if (identity) owner.current = identity.subject;
  const subject = owner.current;
  // AuthBoundary keys this subtree by subject, including after a different user signs in.
  const [client] = useState(() => createQueryClient());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // StrictMode replays effects without ending the session. Clear only a real unmount.
      queueMicrotask(() => {
        if (!mounted.current) client.clear();
      });
    };
  }, [client]);
  return (
    <ServerCacheProvider client={client} subject={subject} enabled={!needsLogin}>
      <RefreshNotice />
      {children}
    </ServerCacheProvider>
  );
}
function RefreshNotice() {
  const { scope } = useServerCache();
  const cache = scope.client.getQueryCache();
  const subscribe = useCallback(
    (notify: () => void) => {
      const a = cache.subscribe(notify);
      const b = onlineManager.subscribe(notify);
      return () => {
        a();
        b();
      };
    },
    [cache],
  );
  const snapshot = useCallback(() => {
    if (!onlineManager.isOnline())
      return "Offline. Cached content is available; reconnect to refresh.";
    return cache
      .getAll()
      .some(
        (q) =>
          q.getObserversCount() > 0 && q.state.status === "error" && q.state.data !== undefined,
      )
      ? "Could not refresh. Showing cached content."
      : "";
  }, [cache]);
  const message = useSyncExternalStore(subscribe, snapshot);
  return message ? (
    <aside className="session-bar" role="alert">
      {message}
      {onlineManager.isOnline() && (
        <button
          onClick={() =>
            void scope.client.refetchQueries({
              type: "active",
              predicate: (q) => q.state.status === "error",
            })
          }
        >
          Retry refresh
        </button>
      )}
    </aside>
  ) : null;
}
export async function fetchResource<T>(
  scope: CacheScope,
  path: string,
  signal: AbortSignal,
): Promise<T> {
  if (scope.hasPending(path)) await scope.wait(path, signal);
  signal.throwIfAborted();
  return api<T>(path, "GET", undefined, { signal, subject: scope.subject });
}
export function resourceOptions<T>(scope: CacheScope, path: string) {
  return {
    queryKey: resourceKey(scope.subject, path),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchResource<T>(scope, path, signal),
  };
}
export function usePrefetchIssue() {
  const { scope, enabled } = useServerCache();
  return useCallback(
    (path: string) => {
      if (enabled) void scope.client.prefetchQuery(resourceOptions(scope, path));
    },
    [scope, enabled],
  );
}
export type ResourceKey = ReturnType<typeof resourceKey>;
export function isResourceKey(key: QueryKey): key is ResourceKey {
  return (
    key.length === 4 &&
    key[0] === "resource" &&
    typeof key[1] === "string" &&
    (key[2] === null || typeof key[2] === "string") &&
    typeof key[3] === "string"
  );
}
