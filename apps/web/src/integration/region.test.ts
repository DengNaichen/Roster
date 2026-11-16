import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@supabase/supabase-js")>();
  return {
    ...original,
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: { access_token: "signed-test-token" } } }),
      },
    }),
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("configured edge region", () => {
  it.each([
    [undefined, null],
    ["eu-west-3", "eu-west-3"],
    ["any", null],
    ["", null],
  ])("routes %s without changing authentication or retrying writes", async (region, expected) => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-test-key");
    vi.stubEnv("VITE_API_BASE_URL", "https://project.supabase.co/functions/v1/api");
    vi.stubEnv("VITE_API_REGION", region);
    vi.stubGlobal("window", { location: { hostname: "app.example" }, dispatchEvent: vi.fn() });
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const { apiFetch } = await import("./api");
    const response = await apiFetch("/api/w/perf-test/issues/PERF-1", {
      method: "PATCH",
      body: '{"priority":2}',
    });
    expect(response.status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.get("x-region")).toBe(expected);
    expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer signed-test-token");
  });
  it("rejects an invalid configured region before a network call", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-test-key");
    vi.stubEnv("VITE_API_BASE_URL", "https://project.supabase.co/functions/v1/api");
    vi.stubEnv("VITE_API_REGION", "not-a-region");
    vi.stubGlobal("window", { location: { hostname: "app.example" } });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { apiFetch } = await import("./api");
    await expect(apiFetch("/api/workspaces")).rejects.toThrow("Invalid VITE_API_REGION");
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("defaults known Roster projects to their database regions and leaves preview automatic", async () => {
  const { functionRegion } = await import("./region");
  expect(functionRegion(undefined, "https://qietzaqhmforixtpicjd.supabase.co")).toBe("eu-west-3");
  expect(functionRegion(undefined, "https://jmmwgdyfcmonzqkurcly.supabase.co/")).toBe(
    "ap-northeast-1",
  );
  expect(functionRegion(undefined, "https://other.supabase.co")).toBeUndefined();
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_LOCAL_PREVIEW", "true");
  vi.stubEnv("VITE_API_REGION", "eu-west-3");
  vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  const { apiFetch } = await import("./api");
  await apiFetch("/api/workspaces");
  expect(fetch.mock.calls[0][1].headers.has("x-region")).toBe(false);
  expect(fetch.mock.calls[0][1].headers.has("Authorization")).toBe(false);
});
