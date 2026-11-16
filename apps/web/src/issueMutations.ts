import { useEffect, useMemo, useSyncExternalStore } from "react";
import { onlineManager, useMutation } from "@tanstack/react-query";
import { api, type Issue, type IssueSummary, type Priority, type Status } from "./shared";
import { useServerCache, workspaceScope, type CacheScope } from "./queryCache";
import { cachedIssue, issuePositions, mergeIssueCaches, type ListPosition } from "./issueCache";

type Patch = Partial<Pick<IssueSummary, "status" | "priority">>;
type Owner = { active: boolean };
type Operation = {
  entry: Entry;
  patch: Patch;
  owner: Owner;
  sent: boolean;
  finished: boolean;
  release: () => void;
};
type Entry = {
  path: string;
  identifier: string;
  confirmed: IssueSummary | Issue;
  pending: Operation[];
  positions: ListPosition[];
  shownStatus: Status;
};

function createIssueMutations(scope: CacheScope, base: string) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let version = 0;
  const publish = () => {
    version++;
    listeners.forEach((listener) => listener());
  };
  const apply = (entry: Entry, record: IssueSummary | Issue) => {
    const visible = entry.pending.reduce((value, op) => ({ ...value, ...op.patch }), record);
    mergeIssueCaches(
      scope.client,
      scope.subject,
      entry.path,
      visible,
      entry.positions,
      entry.shownStatus,
    );
    entry.shownStatus = visible.status;
    publish();
  };
  scope.onConfirmed((path, value) => {
    if (workspaceScope(path) !== workspaceScope(base)) return;
    if (
      !value ||
      typeof value !== "object" ||
      !("identifier" in value) ||
      !("document" in value) ||
      !("status" in value) ||
      !("priority" in value)
    )
      return;
    const entry = entries.get(String(value.identifier));
    if (entry) {
      entry.confirmed = value as Issue;
      apply(entry, entry.confirmed);
    }
  });
  const finish = (op: Operation, updated?: Issue, error?: unknown) => {
    if (op.finished) return;
    op.finished = true;
    const entry = op.entry;
    entry.pending = entry.pending.filter((item) => item !== op);
    if (updated) entry.confirmed = updated;
    const latest =
      cachedIssue(scope.client, scope.subject, entry.path, entry.identifier)?.record ??
      entry.confirmed;
    // Roll back just this operation's fields to the latest acknowledgement, retaining unrelated changes.
    const rollback: Patch = {};
    if (op.patch.status !== undefined) rollback.status = entry.confirmed.status;
    if (op.patch.priority !== undefined) rollback.priority = entry.confirmed.priority;
    apply(entry, updated ?? { ...latest, ...rollback });
    if (error) void scope.invalidate(entry.path);
    if (op.sent && op.patch.status !== undefined)
      void scope.client.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "resource" &&
          q.queryKey[1] === scope.subject &&
          q.queryKey[2] === entry.path.split("/")[3] &&
          /^\/api\/w\/[^/]+\/specs(?:\?|$|\/[^/?]+$)/.test(String(q.queryKey[3])),
        refetchType: "none",
      });
    op.release();
    if (!entry.pending.length) entries.delete(entry.identifier);
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => version,
    pending: () =>
      [...entries.values()]
        .filter((entry) => entry.pending.length)
        .map((entry) => entry.identifier),
    start(identifier: string, patch: Patch, owner: Owner) {
      const path = `${base}/${encodeURIComponent(identifier)}`;
      const seed = cachedIssue(scope.client, scope.subject, path, identifier)?.record;
      if (!seed) throw new Error("Reload the issue before saving.");
      const entry = entries.get(identifier) ?? {
        path,
        identifier,
        confirmed: seed,
        pending: [],
        positions: issuePositions(scope.client, scope.subject, path, identifier),
        shownStatus: seed.status,
      };
      const release = scope.beginWrite(path, { invalidate: false, properties: true });
      const op: Operation = { entry, patch, owner, sent: false, finished: false, release };
      entry.pending.push(op);
      entries.set(identifier, entry);
      apply(entry, seed);
      return op;
    },
    async execute(op: Operation) {
      await scope.enqueue(op.entry.path, [op.entry.identifier], async () => {
        if (op.finished) return;
        if (!op.owner.active) {
          finish(op);
          return;
        }
        op.sent = true;
        try {
          const path =
            op.entry.path +
            (op.patch.status !== undefined && op.patch.priority === undefined ? "/status" : "");
          const updated = await api<Issue>(path, "PATCH", op.patch, {
            subject: scope.subject,
            cacheManaged: true,
          });
          finish(op, updated);
        } catch (error) {
          scope.reject(op.entry.path, error);
          finish(op, undefined, error);
          throw error;
        }
      });
    },
    cancel(owner: Owner) {
      for (const entry of entries.values())
        for (const op of [...entry.pending]) if (op.owner === owner && !op.sent) finish(op);
    },
  };
}
const stores = new WeakMap<CacheScope, Map<string, ReturnType<typeof createIssueMutations>>>();
export function useIssueMutations(base: string, setError: (message: string) => void) {
  const { scope, enabled } = useServerCache();
  const store = useMemo(() => {
    const scopes = stores.get(scope) ?? new Map();
    const store = scopes.get(base) ?? createIssueMutations(scope, base);
    scopes.set(base, store);
    stores.set(scope, scopes);
    return store;
  }, [scope, base]);
  const owner = useMemo(() => ({ active: false, store }), [store]);
  useEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
      owner.store.cancel(owner);
    };
  }, [owner]);
  useSyncExternalStore(store.subscribe, store.snapshot);
  const mutation = useMutation({
    mutationKey: ["issue-properties", scope.subject, base],
    mutationFn: store.execute,
    retry: false,
    networkMode: "always",
  });
  async function change(identifier: string, patch: Patch) {
    if (!enabled) {
      setError("Sign in to continue. Your draft has been kept.");
      return;
    }
    if (!onlineManager.isOnline() || !navigator.onLine) {
      setError("Offline. Reconnect before saving.");
      return;
    }
    setError("");
    try {
      await mutation.mutateAsync(store.start(identifier, patch, owner));
    } catch (error) {
      if (owner.active) setError(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    pendingIssues: store.pending(),
    moveIssue: (identifier: string, status: Status) => change(identifier, { status }),
    changePriority: (identifier: string, priority: Priority) => change(identifier, { priority }),
  };
}
