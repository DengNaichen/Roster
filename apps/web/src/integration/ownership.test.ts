import { afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getSession: auth.session } }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});
function configure() {
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("VITE_API_BASE_URL", "https://project.supabase.co/functions/v1/api");
  vi.stubGlobal("window", { location: { hostname: "app.example" }, dispatchEvent: vi.fn() });
}
it("rejects an old owner write before sending with a replacement user token", async () => {
  configure();
  auth.session.mockResolvedValue({
    data: { session: { user: { id: "replacement-user" }, access_token: "test-only" } },
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { api } = await import("./api");
  await expect(
    api("/api/w/alpha/issues/AL-1", "PATCH", { priority: 2 }, { subject: "original-user" }),
  ).rejects.toThrow("Request identity changed");
  expect(fetcher).not.toHaveBeenCalled();
  expect(window.dispatchEvent).not.toHaveBeenCalled();
});
it("times out a pending session lookup and never sends the write when that lookup completes late", async () => {
  configure();
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  auth.session.mockImplementation(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { api } = await import("./api");
  const saving = api(
    "/api/w/alpha/issues/AL-1",
    "PATCH",
    { priority: 2 },
    { subject: "original-user" },
  );
  const rejected = expect(saving).rejects.toThrow("Save not confirmed");
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  resolve({ data: { session: { user: { id: "original-user" }, access_token: "test-only" } } });
  await Promise.resolve();
  await Promise.resolve();
  expect(fetcher).not.toHaveBeenCalled();
});
