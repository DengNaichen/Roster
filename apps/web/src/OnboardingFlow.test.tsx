import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { fixtureIssue, json } from "./test/fixtures";
import type { IssueSummary, Team, Workspace } from "./shared";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

it("guides a new user from zero workspaces to team creation, first visible issue, and team-scoped MCP setup", async () => {
  const workspaces: Workspace[] = [];
  const teams: Team[] = [];
  const issues: IssueSummary[] = [];
  let workspaceCreations = 0;
  let failWorkspaceOnce = true;

  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options?: RequestInit) => {
      const path = String(url);
      const method = options?.method ?? "GET";
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;

      if (path === "/api/workspaces" && method === "GET") {
        return json({ workspaces });
      }
      if (path === "/api/workspaces" && method === "POST") {
        if (failWorkspaceOnce) {
          failWorkspaceOnce = false;
          return json({ error: { message: "Temporary network failure" } }, 503);
        }
        workspaceCreations += 1;
        const created = { slug: body.slug as string, name: body.name as string };
        workspaces.push(created);
        return json(created, 201);
      }
      if (path.endsWith("/access")) {
        return json({ enabled: true, role: "admin", subject: "user-1" });
      }
      if (path.endsWith("/teams") && method === "GET") {
        return json({ teams });
      }
      if (path.endsWith("/team-directory")) {
        return json({ teams });
      }
      if (path.endsWith("/teams") && method === "POST") {
        const created: Team = {
          key: body.key,
          name: body.name,
          emoji: body.emoji ?? "",
          private: Boolean(body.private),
          joined: true,
          accessible: true,
          can_manage: true,
          membership_enabled: true,
          next_number: 1,
        };
        teams.push(created);
        return json(created, 201);
      }
      if (path.includes("/projects")) return json({ projects: [] });
      if (path.includes("/label-groups")) return json({ groups: [] });
      if (path.includes("/labels")) return json({ labels: [] });
      if (path.endsWith("/assignees")) return json({ assignees: [] });
      if (path.includes("/issues") && method === "GET") {
        if (path.includes("status=triage")) {
          return json({ issues: issues.filter((item) => item.status === "triage") });
        }
        return json({ issues });
      }
      if (path.endsWith("/issues") && method === "POST") {
        const created: IssueSummary = {
          ...fixtureIssue,
          identifier: `${body.team}-${issues.length + 1}`,
          title: body.title,
          status: body.status,
        };
        issues.push(created);
        return json({ ...created, document: { lead: "", sections: [], criteria: [] } }, 201);
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    }),
  );

  window.history.replaceState(null, "", "/");
  render(<App />);

  // Step 1: Zero-workspaces welcome screen -> Create workspace (with cancel + error retry)
  expect(await screen.findByRole("heading", { name: "Welcome to Roster" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

  const nameInput = await screen.findByRole("textbox", { name: "Name" });
  const slugInput = screen.getByRole("textbox", { name: "Slug" }) as HTMLInputElement;
  fireEvent.change(nameInput, { target: { value: "Studio Sandbox" } });
  expect(slugInput.value).toBe("studio-sandbox");

  // Cancel does not create or strand the user
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(workspaces).toHaveLength(0);

  // Reopen, recover from transient failure without losing draft or duplicating workspaces
  fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
  const wsDialog = within(await screen.findByRole("dialog", { name: "Create workspace" }));
  fireEvent.change(wsDialog.getByRole("textbox", { name: "Name" }), {
    target: { value: "Studio Sandbox" },
  });
  fireEvent.click(wsDialog.getByRole("button", { name: "Create workspace" }));
  expect(await wsDialog.findByText("Temporary network failure")).toBeTruthy();
  expect(workspaces).toHaveLength(0);

  fireEvent.click(wsDialog.getByRole("button", { name: "Create workspace" }));
  await waitFor(() => expect(window.location.pathname).toBe("/studio-sandbox/"));
  expect(workspaceCreations).toBe(1);

  // Step 2: Zero-teams workspace disables header New issue and guides to Create team
  expect(await screen.findByRole("heading", { name: "Create your first team" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "New issue" }) as HTMLButtonElement).disabled).toBe(
    true,
  );

  fireEvent.click(screen.getAllByRole("button", { name: "Create team" })[1]);
  const teamDialog = within(await screen.findByRole("dialog", { name: "Create team" }));
  fireEvent.change(teamDialog.getByRole("textbox", { name: "Name" }), {
    target: { value: "Agent Platform" },
  });
  const keyInput = teamDialog.getByRole("textbox", {
    name: "Identifier (Key)",
  }) as HTMLInputElement;
  expect(keyInput.value).toBe("AP");

  fireEvent.click(teamDialog.getByRole("button", { name: "Create team" }));
  await waitFor(() => expect(window.location.pathname).toBe("/studio-sandbox/team/AP/issues"));

  // Step 3: Team empty state offers both first issue creation and MCP setup
  expect(await screen.findByRole("heading", { name: "Agent Platform is ready" })).toBeTruthy();

  // Creating first issue defaults to Todo (not Triage) so it stays visible immediately
  fireEvent.click(screen.getByRole("button", { name: "Create first issue" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), {
    target: { value: "Ship onboarding flow" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
  expect(await screen.findByText("Ship onboarding flow")).toBeTruthy();
  expect(issues[0].status).toBe("todo");

  // Step 4: Navigate to team-scoped MCP integration settings and verify real identifiers
  await act(async () => {
    window.history.pushState(null, "", "/studio-sandbox/settings/integrations?team=AP");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(await screen.findByRole("heading", { name: "Coding agents (MCP)" })).toBeTruthy();
  const urlField = screen.getByLabelText("Workspace MCP URL") as HTMLInputElement;
  expect(urlField.value).toContain("/w/studio-sandbox/mcp");

  const promptBlock = screen.getByLabelText("Agent verification prompt");
  expect(promptBlock.textContent).toContain("`roster-studio-sandbox`");
  expect(promptBlock.textContent).toContain("`AP`");
  expect(promptBlock.textContent).toContain('"Agent Platform"');

  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(promptBlock.textContent),
  );
});
