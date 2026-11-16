import { useCallback, useReducer } from "react";
import { useQuery } from "@tanstack/react-query";
import { resourceOptions, useServerCache } from "./queryCache";

export function useResource<T>(path: string | null, initial: T) {
  const { scope, enabled } = useServerCache();
  const [, renderUpdate] = useReducer((version: number) => version + 1, 0);
  const options = resourceOptions<T>(scope, path ?? "");
  const query = useQuery({ ...options, enabled: enabled && path !== null });
  const { refetch } = query;
  const reload = useCallback(async () => {
    if (path !== null && enabled) await refetch({ cancelRefetch: false });
  }, [path, enabled, refetch]);
  const update = useCallback(
    (change: (current: T) => T) => {
      if (path === null) return;
      const key = resourceOptions<T>(scope, path).queryKey;
      if (!scope.hasPending(path)) void scope.client.cancelQueries({ queryKey: key, exact: true });
      scope.client.setQueryData<T>(key, (current) =>
        current === undefined ? undefined : change(current),
      );
      // Keep the setter contract for immediate checkbox feedback in the current input event.
      renderUpdate();
    },
    [scope, path],
  );
  const hasData = query.data !== undefined;
  const error =
    query.fetchStatus === "paused" && !hasData
      ? "Offline. Reconnect to load this content."
      : !hasData && query.error
        ? query.error.message
        : "";
  return {
    data: query.data ?? initial,
    loading: path !== null && enabled && query.isPending && query.fetchStatus !== "paused",
    error,
    reload,
    update,
    refreshing: query.isFetching,
    hasData,
  };
}
