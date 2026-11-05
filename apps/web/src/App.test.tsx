import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { navigate } from "./shared";
import { fixtureIssue, json } from "./test/fixtures";

let calls: string[];

it("opens initiative routes through navigation and retains the scope on direct entry", async () => {
  const original = window.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) => {
      const path = String(url);
      const item = {
        id: 7,
        name: "Objective",
        description: "Outcome",
        archived: false,
        project_ids: [],
      };
      if (path.endsWith("/initiatives/7")) return Promise.resolve(json(item));
      if (path.includes("/initiatives?")) return Promise.resolve(json({ initiatives: [item] }));
      return original(url, options);
    }),
  );
  const first = render(<App />);
  fireEvent.click(await screen.findByRole("link", { name: "Initiatives" }));
  fireEvent.click(await screen.findByRole("link", { name: "Objective" }));
  await screen.findByRole("button", { name: "Edit initiative" });
  expect(window.location.pathname).toBe("/default/initiative/7");
  first.unmount();
  render(<App />);
  await screen.findByRole("button", { name: "Edit initiative" });
  expect(screen.getByText("Outcome")).toBeTruthy();
});
beforeEach(() => {
  calls = [];
  window.history.replaceState(null, "", "/default/");
  vi.stubGlobal(
    "fetch",
    vi.fn((url) => {
      const path = String(url);
      calls.push(path);
      if (path === "/auth/session") return Promise.resolve(json({ enabled: false }));
      if (path === "/api/workspaces")
        return Promise.resolve(
          json({ workspaces: [{ slug: "default", name: "Fixture workspace" }] }),
        );
      if (path.endsWith("/access"))
        return Promise.resolve(json({ enabled: false, role: "", subject: "" }));
      if (path.endsWith("/teams"))
        return Promise.resolve(
          json({ teams: [{ key: "AL", name: "Fixture team", emoji: "", next_number: 2 }] }),
        );
      if (path.includes("/projects")) return Promise.resolve(json({ projects: [] }));
      if (path.includes("/label-groups")) return Promise.resolve(json({ groups: [] }));
      if (path.includes("/labels")) return Promise.resolve(json({ labels: [] }));
      if (path.includes("/issues?")) return Promise.resolve(json({ issues: [fixtureIssue] }));
      throw new Error(`Unexpected request ${path}`);
    }),
  );
});

it("loads settings independently of project and label catalogs", async () => {
  window.history.replaceState(null, "", "/default/settings");
  render(<App />);
  await screen.findByRole("heading", { name: "Fixture team" });
  // The sidebar counts a team's Triage on its own; nothing else may load catalogs.
  const catalogCalls = calls.filter((path) => /projects|labels|issues/.test(path));
  expect(catalogCalls.every((path) => /\/issues\?.*status=triage/.test(path))).toBe(true);
});

it("keeps the shell mounted, resets page state, and searches without reloading catalogs", async () => {
  render(<App />);
  await screen.findByRole("link", { name: "Fixture issue" });
  await screen.findByRole("button", { name: "Workspace: Fixture workspace" });
  const initialCatalogs = calls.filter((path) => !path.includes("/issues?"));
  fireEvent.click(screen.getByRole("button", { name: "Fixture team" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select AL-1" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search issues" }), {
    target: { value: "fixture" },
  });
  fireEvent.submit(screen.getByRole("search"));
  await waitFor(() => expect(calls.some((path) => path.includes("query=fixture"))).toBe(true));
  expect(calls.filter((path) => !path.includes("/issues?"))).toEqual(initialCatalogs);
  act(() => navigate("/default/settings"));
  await screen.findByRole("heading", { name: "Fixture team" });
  expect(screen.getByRole("navigation", { name: "Settings navigation" })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Workspace navigation" })).toBeNull();
  act(() => navigate("/default/"));
  await screen.findByRole("link", { name: "Fixture issue" });
  expect((screen.getByRole("searchbox", { name: "Search issues" }) as HTMLInputElement).value).toBe(
    "",
  );
  expect((screen.getByRole("checkbox", { name: "Select AL-1" }) as HTMLInputElement).checked).toBe(
    false,
  );
  // Supabase session is held by AuthBoundary; workspace navigation never calls the removed Go auth endpoint.
  expect(calls.filter((path) => path === "/auth/session")).toHaveLength(0);
  expect(calls.filter((path) => path.endsWith("/teams"))).toHaveLength(1);
  expect(calls.filter((path) => path === "/api/workspaces")).toHaveLength(2);
});
it("keeps Triage in its own team inbox and out of the issue list", async () => {
  const triaged = {
    ...fixtureIssue,
    identifier: "AL-2",
    title: "Needs a decision",
    status: "triage",
  };
  const planned = { ...fixtureIssue, identifier: "AL-3", title: "Planned work", status: "todo" };
  const original = window.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) => {
      const path = String(url);
      if (path.includes("/issues?")) {
        const items = path.includes("status=triage") ? [triaged] : [triaged, planned];
        return Promise.resolve(json({ issues: items }));
      }
      return original(url, options);
    }),
  );
  window.history.replaceState(null, "", "/default/team/AL/triage");
  const inbox = render(<App />);
  await screen.findByText("Needs a decision");
  expect(screen.getByText("Fixture team / Triage")).toBeTruthy();
  expect(screen.queryByText("Planned work")).toBeNull();
  expect((await screen.findByRole("link", { name: /Triage/ })).textContent).toContain("1");
  inbox.unmount();
  window.history.replaceState(null, "", "/default/team/AL/issues");
  render(<App />);
  await screen.findByText("Planned work");
  expect(screen.queryByText("Needs a decision")).toBeNull();
});
it("narrows the team issue list with Active, Backlog and All issues views", async () => {
  const issue = (identifier: string, status: string) => ({
    ...fixtureIssue,
    identifier,
    title: `${status} issue`,
    status,
  });
  const issues = [
    issue("AL-2", "in_progress"),
    issue("AL-3", "backlog"),
    issue("AL-4", "done"),
    issue("AL-5", "triage"),
  ];
  const original = window.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) => {
      if (String(url).includes("/issues?")) return Promise.resolve(json({ issues }));
      return original(url, options);
    }),
  );
  window.history.replaceState(null, "", "/default/team/AL/issues");
  render(<App />);
  const tab = (name: string) => screen.getByRole("tab", { name });
  await screen.findByText("in_progress issue");
  expect(tab("Active").getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByText("backlog issue")).toBeNull();
  expect(screen.queryByText(/\d+ issues$/)).toBeNull();
  fireEvent.click(tab("Backlog"));
  await screen.findByText("backlog issue");
  expect(screen.queryByText("in_progress issue")).toBeNull();
  fireEvent.click(tab("All issues"));
  await screen.findByText("in_progress issue");
  expect(screen.getByText("backlog issue")).toBeTruthy();
  // Done stays collapsed and Triage never joins the list.
  expect(screen.queryByText("done issue")).toBeNull();
  expect(screen.queryByText("triage issue")).toBeNull();
});

it("keeps settings navigation on direct entry and returns to the previous work page", async () => {
  window.history.replaceState(null, "", "/default/team/AL/issues");
  render(<App />);
  await screen.findByRole("link", { name: "Fixture issue" });
  act(() => navigate("/default/settings"));
  await screen.findByRole("heading", { name: "Teams" });
  fireEvent.click(screen.getByRole("link", { name: "Labels" }));
  await screen.findByRole("heading", { name: "Labels" });
  expect(window.location.pathname).toBe("/default/settings/labels");
  expect(screen.getByRole("link", { name: "Labels" }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(screen.getByRole("link", { name: "Back to workspace" }));
  await screen.findByRole("link", { name: "Fixture issue" });
  expect(window.location.pathname).toBe("/default/team/AL/issues");
});
