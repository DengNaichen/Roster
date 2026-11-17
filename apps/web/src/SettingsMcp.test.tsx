import { fireEvent, render, screen, waitFor } from "./test/query-wrapper";
import { expect, it, vi } from "vitest";
import App from "./App";
import { json } from "./test/fixtures";

it("renders the unified MCP URL, preselects requested team, and copies agent verification prompt", async () => {
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = String(url);
      if (path === "/api/workspaces") {
        return json({ workspaces: [{ slug: "studio-sandbox", name: "Studio Sandbox" }] });
      }
      if (path.endsWith("/access")) {
        return json({ enabled: true, role: "admin", subject: "user-1" });
      }
      if (path.endsWith("/teams") || path.endsWith("/team-directory")) {
        return json({
          teams: [
            {
              key: "CORE",
              name: "Core Engine",
              emoji: "",
              private: false,
              joined: true,
              accessible: true,
              can_manage: true,
              membership_enabled: true,
              next_number: 1,
            },
            {
              key: "AP",
              name: "Agent Platform",
              emoji: "",
              private: false,
              joined: true,
              accessible: true,
              can_manage: true,
              membership_enabled: true,
              next_number: 1,
            },
          ],
        });
      }
      if (path.includes("/issues?")) return json({ issues: [] });
      throw new Error(`Unexpected request ${path}`);
    }),
  );

  window.history.replaceState(null, "", "/studio-sandbox/settings/integrations?team=AP");
  render(<App />);

  expect(await screen.findByRole("heading", { name: "Coding agents (MCP)" })).toBeTruthy();
  const urlField = screen.getByLabelText("MCP server URL") as HTMLInputElement;
  expect(new URL(urlField.value).pathname).toBe("/mcp");

  const promptBlock = screen.getByLabelText("Agent verification prompt");
  await waitFor(() => expect(promptBlock.textContent).toContain("`AP`"));
  expect(promptBlock.textContent).toContain("`roster-studio-sandbox`");
  expect(promptBlock.textContent).toContain('"Agent Platform"');

  fireEvent.click(screen.getByRole("radio", { name: "Claude Code" }));
  expect(screen.getByText(/claude mcp add --transport http roster-studio-sandbox/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(promptBlock.textContent),
  );
  expect((screen.getByRole("button", { name: "Configure" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
