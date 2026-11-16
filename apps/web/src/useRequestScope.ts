import { useEffect, useMemo } from "react";
import { apiPath } from "./shared";
import { useServerCache } from "./queryCache";

// Writes retain per-entity ordering and disposal semantics. Shared Query owns all reads.
export function useRequestScope(key: string) {
  const { scope: cache } = useServerCache();
  const path = key.startsWith("/api/") ? key : apiPath("/");
  const scope = useMemo(() => {
    let active = false;
    let generation = 0;
    const releases = new Set<() => void>();
    const current = (started: number) => active && generation === started;
    return {
      key,
      activate() {
        active = true;
      },
      dispose() {
        active = false;
        generation++;
        if (releases.size) cache.discard(path);
        releases.forEach((release) => release());
        releases.clear();
      },
      isActive() {
        return active;
      },
      async write<T>(
        entity: string | string[],
        request: () => Promise<T>,
        success: (value: T) => void,
        failure: (cause: Error) => void,
      ) {
        const started = generation;
        if (!current(started)) return false;
        const release = cache.beginWrite(path);
        releases.add(release);
        const entities = typeof entity === "string" ? [entity] : entity;
        let sent = false;
        const operation = cache.enqueue(path, entities, async () => {
          if (!current(started)) return false;
          sent = true;
          try {
            const value = await request();
            if (current(started)) success(value);
            return current(started);
          } catch (cause) {
            if (current(started))
              failure(cause instanceof Error ? cause : new Error(String(cause)));
            return false;
          }
        });
        try {
          return await operation;
        } finally {
          release();
          releases.delete(release);
          if (sent && !current(started)) void cache.invalidate(path, true);
        }
      },
    };
  }, [key, path, cache]);
  useEffect(() => {
    scope.activate();
    return () => scope.dispose();
  }, [scope]);
  return scope;
}
