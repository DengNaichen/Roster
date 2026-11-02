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
});
