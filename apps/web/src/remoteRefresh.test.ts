import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { focusManager, onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { startRemoteRefresh } from "./remoteRefresh";
import { remoteRefreshInterval } from "./integration/refresh";

let client: QueryClient;
let stop = () => {};
let unsubscribe = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  stop();
  unsubscribe();
  client.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
});
async function observe(fn: () => Promise<string>) {
  const query = new QueryObserver(client, {
    queryKey: ["resource", "owner", "alpha", "/api/w/alpha/issues"],
    queryFn: fn,
  });
  unsubscribe = query.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  stop = startRemoteRefresh(client, "owner", 15000);
}
it("uses one visible/online timer, catches up once, and stops after disposal", async () => {
  const fn = vi.fn().mockResolvedValue("value");
  await observe(fn);
  await vi.advanceTimersByTimeAsync(15000);
  expect(fn).toHaveBeenCalledTimes(2);
  focusManager.setFocused(false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fn).toHaveBeenCalledTimes(2);
  onlineManager.setOnline(false);
  focusManager.setFocused(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fn).toHaveBeenCalledTimes(2);
  onlineManager.setOnline(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(fn).toHaveBeenCalledTimes(3);
  stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(fn).toHaveBeenCalledTimes(3);
});
it("reuses a pending read across timer and focus events without overlapping it", async () => {
  let resolve: (value: string) => void = () => {};
  const fn = vi.fn().mockImplementation(() => new Promise<string>((r) => (resolve = r)));
  await observe(fn);
  await vi.advanceTimersByTimeAsync(15000);
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fn).toHaveBeenCalledTimes(1);
  resolve("confirmed");
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(fn).toHaveBeenCalledTimes(2);
});
it("backs failures off to 30/60 seconds and resets after success", async () => {
  const fn = vi.fn().mockResolvedValueOnce("initial").mockRejectedValue(new Error("offline"));
  await observe(fn);
  await vi.advanceTimersByTimeAsync(15000);
  expect(fn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(29999);
  expect(fn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(fn).toHaveBeenCalledTimes(3);
  fn.mockResolvedValue("recovered");
  await vi.advanceTimersByTimeAsync(60000);
  expect(fn).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(15000);
  expect(fn).toHaveBeenCalledTimes(5);
});
it("does not poll another user, inactive query, global resource or history pages", async () => {
  const fn = vi.fn().mockResolvedValue("own");
  await observe(fn);
  const other = vi.fn().mockResolvedValue("other");
  const observers = [
    ["resource", "other", "alpha", "/api/w/alpha/issues"],
    ["resource", "owner", null, "/api/workspaces"],
    ["resource", "owner", "alpha", "/api/w/alpha/issues/AL-1/work-logs", "pages"],
  ].map((queryKey) => new QueryObserver(client, { queryKey, queryFn: other }));
  const cleanups = observers.map((observer) => observer.subscribe(() => {}));
  await client.fetchQuery({
    queryKey: ["resource", "owner", "alpha", "/api/w/alpha/specs"],
    queryFn: other,
  });
  other.mockClear();
  await vi.advanceTimersByTimeAsync(15000);
  expect(fn).toHaveBeenCalledTimes(2);
  expect(other).not.toHaveBeenCalled();
  cleanups.forEach((fn) => fn());
});
it("validates configuration and permits disabling the coordinator", async () => {
  expect(remoteRefreshInterval(undefined)).toBe(15000);
  expect(remoteRefreshInterval("0")).toBe(0);
  for (const input of ["NaN", "-1", "1.5", "999", "60001"])
    expect(() => remoteRefreshInterval(input)).toThrow();
  const fn = vi.fn().mockResolvedValue("ok");
  await observe(fn);
  stop();
  stop = startRemoteRefresh(client, "owner", 0);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fn).toHaveBeenCalledTimes(1);
});

it("keeps healthy resources and permission recovery on schedule when another query is missing", async () => {
  const fn = vi.fn().mockResolvedValue("healthy");
  await observe(fn);
  const missing = vi.fn().mockRejectedValue(Object.assign(new Error("Missing"), { status: 404 }));
  const observer = new QueryObserver(client, {
    queryKey: ["resource", "owner", "alpha", "/api/w/alpha/issues/AL-1"],
    queryFn: missing,
  });
  const unmount = observer.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(45000);
  expect(fn).toHaveBeenCalledTimes(4);
  missing.mockResolvedValue("permission restored");
  await vi.advanceTimersByTimeAsync(15000);
  expect(observer.getCurrentResult().data).toBe("permission restored");
  unmount();
});
it("leaves immutable revisions and the unpaged link picker to focus freshness", async () => {
  const fn = vi.fn().mockResolvedValue("own");
  await observe(fn);
  const other = vi.fn().mockResolvedValue("catalog");
  const observers = [
    "/api/w/alpha/issues?limit=-1",
    "/api/w/alpha/specs/SP-1/revisions/1",
    "/api/w/alpha/teams/AL/assignees",
  ].map(
    (path) =>
      new QueryObserver(client, { queryKey: ["resource", "owner", "alpha", path], queryFn: other }),
  );
  const cleanups = observers.map((o) => o.subscribe(() => {}));
  await vi.advanceTimersByTimeAsync(0);
  other.mockClear();
  await vi.advanceTimersByTimeAsync(15000);
  expect(other).not.toHaveBeenCalled();
  cleanups.forEach((fn) => fn());
});
