import { fireEvent, render, screen, waitFor, within } from "./test/query-wrapper";
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

it("guides a new user from zero workspaces to team creation and a visible first Todo issue", async () => {
  const workspaces: Workspace[] = [];
  const teams: Team[] = [];
  const issues: IssueSummary[] = [];
  let workspaceCreations = 0;
  let failWorkspaceOnce = true;

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
      if (path.includes("/projects")) return json({ projects: [] });
      if (path.includes("/label-groups")) return json({ groups: [] });
      if (path.includes("/labels")) return json({ labels: [] });
      if (path.endsWith("/assignees")) return json({ assignees: [] });
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

  expect(await screen.findByRole("heading", { name: "Welcome to Roster" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

  const firstWsDialog = within(await screen.findByRole("dialog", { name: "Create workspace" }));
  fireEvent.change(firstWsDialog.getByRole("textbox", { name: "Name" }), {
    target: { value: "Studio Sandbox" },
  });
  expect((firstWsDialog.getByRole("textbox", { name: "Slug" }) as HTMLInputElement).value).toBe(
    "studio-sandbox",
  );

  fireEvent.click(firstWsDialog.getByRole("button", { name: "Cancel" }));
  expect(workspaces).toHaveLength(0);

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

  expect(await screen.findByRole("heading", { name: "Create your first team" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "New issue" }) as HTMLButtonElement).disabled).toBe(
    true,
  );

  fireEvent.click(screen.getAllByRole("button", { name: "Create team" })[1]);
  const teamDialog = within(await screen.findByRole("dialog", { name: "Create team" }));
  fireEvent.change(teamDialog.getByRole("textbox", { name: "Name" }), {
    target: { value: "Agent Platform" },
  });
  expect(
    (teamDialog.getByRole("textbox", { name: "Identifier (Key)" }) as HTMLInputElement).value,
  ).toBe("AP");

  fireEvent.click(teamDialog.getByRole("button", { name: "Create team" }));
  await waitFor(() => expect(window.location.pathname).toBe("/studio-sandbox/team/AP/issues"));

  expect(await screen.findByRole("heading", { name: "Agent Platform is ready" })).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Connect coding agent (MCP)" }).getAttribute("href"),
  ).toBe("/studio-sandbox/settings/integrations?team=AP");

  fireEvent.click(screen.getByRole("button", { name: "Create first issue" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), {
    target: { value: "Ship onboarding flow" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
  expect(await screen.findByText("Ship onboarding flow")).toBeTruthy();
  expect(issues[0].status).toBe("todo");
});
