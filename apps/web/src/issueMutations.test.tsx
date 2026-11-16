import { act, renderHook, waitFor, createQueryWrapper } from "./test/query-wrapper";
import { beforeEach, expect, it, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { createQueryClient, resourceKey } from "./queryCache";
import { useIssueMutations } from "./issueMutations";
import { useResource } from "./useResource";
import { deferred, fixtureIssue, json } from "./test/fixtures";
import type { IssueDetails } from "./shared";
import type { IssueList } from "./issueCache";
const base = "/api/w/alpha/issues";
const detail = `${base}/AL-1`;
const list = `${base}?query=&label_mode=any`;
const key = (path: string) => resourceKey("test-user", path);
function fixture() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { staleTime: 30_000, retry: false } });
  client.setQueryData(key(detail), fixtureIssue);
  client.setQueryData(key(list), { issues: [fixtureIssue], next_cursor: null });
  const wrapper = createQueryWrapper(client);
  const errors = vi.fn();
  const useView = () => ({
    writes: useIssueMutations(base, errors),
    detail: useResource<IssueDetails | null>(detail, null),
    list: useResource<IssueList>(list, { issues: [] }),
  });
  return { client, wrapper, errors, useView };
}
beforeEach(() => window.history.replaceState(null, "", "/alpha/"));

it("shows one optimistic value in list and detail and confirms with no catalog or detail GET", async () => {
  const save = deferred<Response>();
  const fetcher = vi.fn(() => save.promise);
  vi.stubGlobal("fetch", fetcher);
  const f = fixture();
  const labels = key("/api/w/alpha/labels");
  f.client.setQueryData(labels, { labels: [] });
  const unrelated = key("/api/w/alpha/issues/AL-2");
  f.client.setQueryData(unrelated, { ...fixtureIssue, identifier: "AL-2" });
  const before = f.client.getQueryState(labels)?.dataUpdatedAt;
  const { result } = renderHook(f.useView, { wrapper: f.wrapper });
  let saving: Promise<void>;
  act(() => {
    saving = result.current.writes.changePriority("AL-1", 2);
  });
  expect(result.current.detail.data?.priority).toBe(2);
  expect(result.current.list.data.issues[0].priority).toBe(2);
  expect(result.current.writes.pendingIssues).toEqual(["AL-1"]);
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  await act(async () => {
    save.resolve(json({ ...fixtureIssue, priority: 2 }));
    await saving;
  });
  expect(result.current.writes.pendingIssues).toEqual([]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(f.client.getQueryState(labels)?.dataUpdatedAt).toBe(before);
  expect(f.client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  expect(result.current.list.data.issues[0]).not.toHaveProperty("document");
  expect(result.current.list.data.issues[0]).not.toHaveProperty("comments");
});

it("continues after an earlier failure, preserves later optimism and rolls back only the failed fields", async () => {
  const saves = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
  let writes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) =>
      options?.method === "PATCH"
        ? saves[writes++].promise
        : Promise.resolve(
            json(
              String(url).includes("?")
                ? { issues: [{ ...fixtureIssue, priority: 2 }], next_cursor: null }
                : { ...fixtureIssue, priority: 2 },
            ),
          ),
    ),
  );
  const f = fixture();
  const { result } = renderHook(f.useView, { wrapper: f.wrapper });
  let one: Promise<void>, two: Promise<void>, three: Promise<void>;
  act(() => {
    one = result.current.writes.moveIssue("AL-1", "in_progress");
    two = result.current.writes.changePriority("AL-1", 2);
    three = result.current.writes.moveIssue("AL-1", "done");
  });
  expect(result.current.detail.data).toMatchObject({ status: "done", priority: 2 });
  await waitFor(() => expect(writes).toBe(1));
  await act(async () => {
    saves[0].resolve(json({ error: "first denied" }, 403));
    await one;
  });
  await waitFor(() => expect(writes).toBe(2));
  expect(result.current.detail.data).toMatchObject({ status: "done", priority: 2 });
  await act(async () => {
    saves[1].resolve(json({ ...fixtureIssue, priority: 2 }));
    await two;
  });
  await waitFor(() => expect(writes).toBe(3));
  expect(result.current.detail.data).toMatchObject({ status: "done", priority: 2 });
  await act(async () => {
    saves[2].resolve(json({ error: "last failed" }, 500));
    await three;
  });
  await waitFor(() =>
    expect(result.current.detail.data).toMatchObject({ status: "todo", priority: 2 }),
  );
  expect(f.errors).toHaveBeenCalledWith("first denied");
  expect(f.errors).toHaveBeenCalledWith("last failed");
});

it("keeps sent writes shared after navigation, cancels unsent work and restores failures in the new view", async () => {
  const sent = deferred<Response>();
  let writes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) =>
      options?.method === "PATCH"
        ? (writes++, sent.promise)
        : Promise.resolve(
            json(String(url).includes("?") ? { issues: [fixtureIssue] } : fixtureIssue),
          ),
    ),
  );
  const f = fixture();
  const first = renderHook(f.useView, { wrapper: f.wrapper });
  let saving: Promise<void>, queued: Promise<void>;
  act(() => {
    saving = first.result.current.writes.moveIssue("AL-1", "in_progress");
  });
  await waitFor(() => expect(writes).toBe(1));
  act(() => {
    queued = first.result.current.writes.changePriority("AL-1", 2);
  });
  first.unmount();
  const next = renderHook(f.useView, { wrapper: f.wrapper });
  expect(next.result.current.detail.data).toMatchObject({
    status: "in_progress",
    priority: fixtureIssue.priority,
  });
  await act(async () => {
    sent.resolve(json({ error: "network lost" }, 500));
    await Promise.all([saving, queued]);
  });
  await waitFor(() => expect(next.result.current.detail.data?.status).toBe("todo"));
  expect(writes).toBe(1);
  expect(next.result.current.writes.pendingIssues).toEqual([]);
});

it("moves rows across triage counts and incomplete filters, preserving another workspace", async () => {
  const save = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) =>
      options?.method === "PATCH"
        ? save.promise
        : Promise.resolve(
            json(
              String(url).endsWith("/AL-1")
                ? fixtureIssue
                : { issues: [fixtureIssue], next_cursor: null },
            ),
          ),
    ),
  );
  const f = fixture();
  const triage = key(`${base}?team=AL&status=triage&limit=-1`);
  const todo = key(`${base}?status=todo`);
  f.client.setQueryData(triage, { issues: [], next_cursor: null });
  f.client.setQueryData(todo, { issues: [fixtureIssue], next_cursor: "more" });
  const other = key("/api/w/beta/issues");
  f.client.setQueryData(other, { issues: [fixtureIssue] });
  const { result } = renderHook(f.useView, { wrapper: f.wrapper });
  let saving: Promise<void>;
  act(() => {
    saving = result.current.writes.moveIssue("AL-1", "triage");
  });
  expect(f.client.getQueryData<IssueList>(triage)?.issues.map((i) => i.identifier)).toEqual([
    "AL-1",
  ]);
  expect(f.client.getQueryData<IssueList>(todo)?.issues).toEqual([]);
  expect(f.client.getQueryState(todo)?.isInvalidated).toBe(true);
  expect(f.client.getQueryData<IssueList>(other)?.issues[0].status).toBe("todo");
  await waitFor(() => expect(result.current.writes.pendingIssues).toHaveLength(1));
  await act(async () => {
    save.resolve(json({ error: "failed" }, 500));
    await saving;
  });
  expect(f.client.getQueryData<IssueList>(triage)?.issues).toEqual([]);
  expect(f.client.getQueryData<IssueList>(todo)?.issues[0].status).toBe("todo");
});

it("updates cycle counts exactly once while another property is queued", async () => {
  const saves = [deferred<Response>(), deferred<Response>()];
  let count = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => saves[count++].promise),
  );
  const f = fixture();
  const issue = { ...fixtureIssue, cycle_id: 7 };
  f.client.setQueryData(key(detail), issue);
  f.client.setQueryData(key(list), { issues: [issue] });
  const cycle = key("/api/w/alpha/cycles/7");
  f.client.setQueryData(cycle, { id: 7, total: 1, done: 0, canceled: 0 });
  const { result } = renderHook(f.useView, { wrapper: f.wrapper });
  let one: Promise<void>, two: Promise<void>;
  act(() => {
    one = result.current.writes.moveIssue("AL-1", "done");
    two = result.current.writes.changePriority("AL-1", 2);
  });
  expect(f.client.getQueryData(cycle)).toMatchObject({ done: 1, total: 1 });
  await waitFor(() => expect(count).toBe(1));
  await act(async () => {
    saves[0].resolve(json({ ...issue, status: "done" }));
    await one;
  });
  await waitFor(() => expect(count).toBe(2));
  await act(async () => {
    saves[1].resolve(json({ ...issue, status: "done", priority: 2 }));
    await two;
  });
  expect(f.client.getQueryData(cycle)).toMatchObject({ done: 1, total: 1 });
});

it("does not queue offline edits and does not resurrect forbidden cached data", async () => {
  const fetcher = vi.fn(() => Promise.resolve(json({ error: "Workspace access denied" }, 403)));
  vi.stubGlobal("fetch", fetcher);
  const f = fixture();
  const { result } = renderHook(f.useView, { wrapper: f.wrapper });
  act(() => onlineManager.setOnline(false));
  await act(async () => result.current.writes.changePriority("AL-1", 2));
  expect(fetcher).not.toHaveBeenCalled();
  expect(result.current.writes.pendingIssues).toEqual([]);
  act(() => onlineManager.setOnline(true));
  await act(async () => result.current.writes.changePriority("AL-1", 2));
  await waitFor(() => expect(result.current.detail.data).toBeNull());
  expect(f.client.getQueryData(key(detail))).toBeUndefined();
  expect(f.client.getQueryData(key(list))).toBeUndefined();
});

it("preserves stale timestamps and prior invalidation while refreshing spec progress after status confirmation", async () => {
  const saved = {
    ...fixtureIssue,
    status: "done" as const,
    updated_at: "2026-11-16T08:00:00.000Z",
  };
  const fetcher = vi.fn((url, options) =>
    Promise.resolve(
      json(
        options?.method === "PATCH"
          ? saved
          : String(url).includes("/specs")
            ? { issue_progress: { done: 1, total: 1 } }
            : String(url).includes("?")
              ? { issues: [saved], next_cursor: null }
              : saved,
      ),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const f = fixture();
  const timestamp = Date.now() - 20_000;
  f.client.setQueryData(
    key(list),
    { issues: [fixtureIssue], next_cursor: null },
    { updatedAt: timestamp },
  );
  const specPath = "/api/w/alpha/specs/SPEC-1";
  f.client.setQueryData(key(specPath), { issue_progress: { done: 0, total: 1 } });
  const { result } = renderHook(
    () => ({
      ...f.useView(),
      spec: useResource(specPath, { issue_progress: { done: 0, total: 0 } }),
    }),
    { wrapper: f.wrapper },
  );
  await act(async () => result.current.writes.moveIssue("AL-1", "done"));
  expect(f.client.getQueryState(key(list))?.dataUpdatedAt).toBe(timestamp);
  await waitFor(() => expect(result.current.spec.data.issue_progress.done).toBe(1));
  expect(fetcher.mock.calls.some(([url]) => String(url) === specPath)).toBe(true);
});

it("keeps a canceled focus validation pending until writes settle instead of making old data fresh", async () => {
  const old = deferred<Response>();
  const save = deferred<Response>();
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) =>
      options?.method === "PATCH"
        ? save.promise
        : ++reads === 1
          ? old.promise
          : Promise.resolve(
              json(
                String(url).includes("?")
                  ? { issues: [{ ...fixtureIssue, priority: 2 }], next_cursor: null }
                  : { ...fixtureIssue, priority: 2 },
              ),
            ),
    ),
  );
  const f = fixture();
  const { result } = renderHook(f.useView, { wrapper: f.wrapper });
  act(() => {
    void result.current.list.reload();
  });
  await waitFor(() => expect(reads).toBe(1));
  let saving: Promise<void>;
  act(() => {
    saving = result.current.writes.changePriority("AL-1", 2);
  });
  expect(f.client.getQueryState(key(list))?.isInvalidated).toBe(true);
  await act(async () => {
    save.resolve(json({ ...fixtureIssue, priority: 2 }));
    await saving;
  });
  await waitFor(() => expect(reads).toBeGreaterThan(1));
  await act(async () => old.resolve(json({ issues: [fixtureIssue] })));
  expect(result.current.list.data.issues[0].priority).toBe(2);
});

it("rejects confirmations from another workspace with the same identifier", async () => {
  const { useServerCache } = await import("./queryCache");
  const failed = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, options) =>
      options?.method === "PATCH" ? failed.promise : new Promise(() => {}),
    ),
  );
  const f = fixture();
  const beta = {
    ...fixtureIssue,
    title: "Beta private title",
    status: "done" as const,
    priority: 4 as const,
  };
  f.client.setQueryData(key("/api/w/beta/issues/AL-1"), beta);
  const { result } = renderHook(() => ({ ...f.useView(), scope: useServerCache().scope }), {
    wrapper: f.wrapper,
  });
  let saving: Promise<void>;
  act(() => {
    saving = result.current.writes.changePriority("AL-1", 2);
  });
  act(() => result.current.scope.confirm("/api/w/beta/issues/AL-1", beta));
  expect(result.current.detail.data).toMatchObject({
    title: fixtureIssue.title,
    status: "todo",
    priority: 2,
  });
  await act(async () => {
    failed.resolve(json({ error: "failed" }, 500));
    await saving;
  });
  expect(result.current.detail.data).toMatchObject({
    title: fixtureIssue.title,
    status: "todo",
    priority: fixtureIssue.priority,
  });
  expect(f.client.getQueryData(key("/api/w/beta/issues/AL-1"))).toEqual(beta);
});
