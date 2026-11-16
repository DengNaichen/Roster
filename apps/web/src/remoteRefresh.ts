import { focusManager, onlineManager, type Query, type QueryClient } from "@tanstack/react-query";

// Only mounted task content/counts and the accessible team list. Picker catalogs keep normal
// focus/reconnect freshness. History pages refresh when the detail's log count changes.
export function remoteResource(query: Query) {
  if (
    query.queryKey.length !== 4 ||
    query.queryKey[0] !== "resource" ||
    typeof query.queryKey[2] !== "string" ||
    typeof query.queryKey[3] !== "string"
  )
    return false;
  const url = new URL(query.queryKey[3], "http://roster.local");
  const path = url.pathname.replace(/^\/api\/w\/[^/]+/, "");
  // The link picker is the only unfiltered, unpaged issue catalog. Sidebar triage is intentional.
  if (
    path === "/issues" &&
    url.searchParams.get("limit") === "-1" &&
    !url.searchParams.has("status")
  )
    return false;
  return /^\/(?:teams|issues|issues\/[^/]+|issues\/[^/]+\/specs|specs|specs\/[^/]+(?:\/(?:issues|dependencies|revisions))?|cycles\/\d+)$/.test(
    path,
  );
}

/** One timer per signed-in cache, shared by every mounted observer. */
export function startRemoteRefresh(client: QueryClient, subject: string, interval: number) {
  if (!interval) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;
  let catchUp = false;
  let delay = interval;
  const available = () => !stopped && focusManager.isFocused() && onlineManager.isOnline();
  const filter = {
    type: "active" as const,
    predicate: (query: Query) => remoteResource(query) && query.queryKey[1] === subject,
  };
  function schedule(ms: number) {
    clearTimeout(timer);
    if (available() && !running) timer = setTimeout(() => void refresh(), ms);
  }
  async function refresh() {
    if (!available() || running) return;
    running = true;
    catchUp = false;
    try {
      // Reuse in-flight reads. Their existing write barrier/AbortSignal protects optimistic state.
      await client.refetchQueries(filter, { cancelRefetch: false });
      const failed = client
        .getQueryCache()
        .findAll(filter)
        .some((q) => {
          if (q.state.status !== "error") return false;
          const error: unknown = q.state.error;
          const status =
            error && typeof error === "object" && "status" in error ? error.status : undefined;
          // Recheck access on the normal cadence, so permissions can recover without slowing healthy views.
          return typeof status !== "number" || status === 408 || status === 429 || status >= 500;
        });
      delay = failed ? Math.min(Math.max(interval, 60_000), delay * 2) : interval;
    } finally {
      running = false;
      schedule(catchUp ? 100 : delay);
    }
  }
  function changed() {
    clearTimeout(timer);
    if (!available()) return;
    delay = interval;
    catchUp = true;
    schedule(100); // coalesce visibility, focus and reconnect events
  }
  const focus = focusManager.subscribe(changed);
  const online = onlineManager.subscribe(changed);
  schedule(interval);
  return () => {
    stopped = true;
    clearTimeout(timer);
    focus();
    online();
  };
}
