import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("API integration boundary", () => {
  it("forces opted-in local preview to isolated loopback with no bearer", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_LOCAL_PREVIEW", "true");
    vi.stubEnv("VITE_API_BASE_URL", "https://remote.example");
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workspaces: [] }),
    });
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    await api("/api/workspaces");
    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:18471/api/workspaces");
    expect(fetch.mock.calls[0][1].headers.has("Authorization")).toBe(false);
  });
  it.each([
    ["18472", "18472"],
    ["18472@remote.example", "18471"],
    ["70000", "18471"],
  ])("keeps preview port %s on loopback", async (port, expected) => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_LOCAL_PREVIEW", "true");
    vi.stubEnv("VITE_PREVIEW_API_PORT", port);
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspaces: [] }) });
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    await api("/api/workspaces");
    expect(fetch.mock.calls[0][0]).toBe(`http://127.0.0.1:${expected}/api/workspaces`);
    expect(fetch.mock.calls[0][1].headers.has("Authorization")).toBe(false);
  });
  it("does not bypass production auth with preview flag", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_LOCAL_PREVIEW", "true");
    vi.stubGlobal("window", {
      location: { hostname: "127.0.0.1" },
      dispatchEvent: vi.fn(),
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    await expect(api("/api/workspaces")).rejects.toThrow("Sign in to continue");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resolves workspace MCP URLs across Edge Functions, local server, and preview", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_API_BASE_URL", "https://proj.supabase.co/functions/v1/api/");
    vi.stubGlobal("window", {
      location: { hostname: "roster.example", origin: "https://roster.example" },
    });
    const hosted = await import("./api");
    expect(hosted.mcpServerUrl("acme-dev")).toBe(
      "https://proj.supabase.co/functions/v1/mcp/w/acme-dev/mcp",
    );

    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:18471");
    const localDev = await import("./api");
    expect(localDev.mcpServerUrl("acme-dev")).toBe("http://127.0.0.1:18471/w/acme-dev/mcp");

    vi.resetModules();
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_LOCAL_PREVIEW", "true");
    vi.stubEnv("VITE_PREVIEW_API_PORT", "18510");
    vi.stubGlobal("window", {
      location: { hostname: "127.0.0.1", origin: "http://127.0.0.1:5217" },
    });
    const preview = await import("./api");
    expect(preview.mcpServerUrl("acme-dev")).toBe("http://127.0.0.1:18510/w/acme-dev/mcp");
  });
});

it("bounds a stalled write including its body and never retries an uncertain result", async () => {
  vi.useFakeTimers();
  try {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_LOCAL_PREVIEW", "true");
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    vi.stubGlobal("fetch", fetcher);
    const { api } = await import("./api");
    const saving = api("/api/w/perf-test/issues/AL-1", "PATCH", { priority: 1 });
    const rejection = expect(saving).rejects.toThrow("Save not confirmed");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("handles conditional 304 without parsing JSON and preserves normal permission errors", async () => {
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_LOCAL_PREVIEW", "true");
  vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 304, headers: { ETag: 'W/"same"' } }));
  vi.stubGlobal("fetch", fetcher);
  const { api } = await import("./api");
  const value = { issues: [] };
  const validator = vi.fn();
  expect(
    await api("/api/w/test/issues", "GET", undefined, {
      conditional: { tag: 'W/"same"', value },
      onValidator: validator,
    }),
  ).toBe(value);
  expect(fetcher.mock.calls[0][1].headers.get("If-None-Match")).toBe('W/"same"');
  expect(validator).toHaveBeenCalledWith('W/"same"');
  await expect(api("/api/w/test/issues")).rejects.toThrow("304 without cached data");
  validator.mockClear();
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ error: { message: "Workspace access denied" } }), {
      status: 403,
    }),
  );
  await expect(
    api("/api/w/test/issues", "GET", undefined, {
      conditional: { tag: 'W/"same"', value },
      onValidator: validator,
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(validator).not.toHaveBeenCalled();
});
it("bounds stalled reads so the remote refresh loop can back off", async () => {
  vi.useFakeTimers();
  try {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_LOCAL_PREVIEW", "true");
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    vi.stubGlobal("fetch", fetcher);
    const { api } = await import("./api");
    const reading = api("/api/w/test/issues");
    const rejection = expect(reading).rejects.toThrow("Request timed out");
    await vi.advanceTimersByTimeAsync(30000);
    await rejection;
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
