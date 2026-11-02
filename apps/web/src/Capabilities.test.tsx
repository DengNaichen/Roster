import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { CapabilitiesProvider, capabilityNames, useCapabilities } from "./Capabilities";
import IssuesPage from "./IssuesPage";
import IssuePage from "./IssuePage";
import { json } from "./test/fixtures";
import type { Team } from "./shared";
vi.unmock("./Capabilities");
const capabilities = Object.fromEntries(
  capabilityNames.map((key) => [
    key,
    ["issues", "teams", "workspaces", "members", "assignees", "assignments"].includes(key),
  ]),
);
test("capability failure blocks opening workspace until an explicit successful retry", async () => {
  let failed = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      failed ? json({ error: "Capabilities unavailable" }, 503) : json({ capabilities }),
    ),
  );
  function Child() {
    const value = useCapabilities();
    return <p>{value.projects ? "Projects enabled" : "Projects not migrated"}</p>;
  }
  render(
    <CapabilitiesProvider slug="demo">
      <Child />
    </CapabilitiesProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Capabilities unavailable",
  );
  expect(screen.queryByText("Projects not migrated")).toBeNull();
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry capabilities" }));
  expect(await screen.findByText("Projects not migrated")).toBeTruthy();
});
test("the original issue composer remains usable without unmigrated catalogs", async () => {
  history.replaceState(null, "", "/demo/team/AL/issues");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      calls.push(String(path));
      if (String(path).endsWith("/capabilities")) return json({ capabilities });
      if (String(path).includes("/issues?")) return json({ issues: [] });
      if (String(path).endsWith("/assignees")) return json({ assignees: [] });
      if (String(path).endsWith("/issues"))
        return json({ error: { message: "Save failed; retry" } }, 409);
      throw Error("Unexpected request: " + path);
    }),
  );
  const team: Team = {
    key: "AL",
    name: "Core",
    emoji: "",
    private: false,
    joined: true,
    accessible: true,
    can_manage: true,
    membership_enabled: true,
    next_number: 1,
  };
  render(
    <CapabilitiesProvider slug="demo">
      <IssuesPage
        route={{ kind: "issues", team: "AL" }}
        teams={[team]}
        teamsLoading={false}
        onCreateTeam={() => {}}
        view="list"
        setView={() => {}}
        sort="auto"
        setSort={() => {}}
      />
    </CapabilitiesProvider>,
  );
  const create = await screen.findByRole("button", { name: "New issue" });
  await waitFor(() => expect(create.hasAttribute("disabled")).toBe(false));
  fireEvent.click(create);
  expect(await screen.findByRole("textbox", { name: "Title" })).toBeTruthy();
  expect(screen.getByText("Cycle · Not migrated yet")).toBeTruthy();
  expect(screen.getByText("Project · Not migrated yet")).toBeTruthy();
  expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).disabled).toBe(
    true,
  );
  expect(calls.some((path) => /\/(projects|labels|label-groups|cycles)(?:[/?]|$)/.test(path))).toBe(
    false,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: "Keep my draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
  expect(await screen.findByText("Save failed; retry")).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
    "Keep my draft",
  );
});

test("missing backend collections are marked as unmigrated rather than shown as empty activity", async () => {
  history.replaceState(null, "", "/demo/issue/AL-1");
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      calls.push(String(path));
      if (String(path).endsWith("/capabilities")) return json({ capabilities });
      if (String(path).endsWith("/issues/AL-1"))
        return json({
          identifier: "AL-1",
          title: "Migrated issue",
          description: "Original description",
          status: "todo",
          priority: 0,
          type: null,
          assignee: null,
          assignments: [],
          project: null,
          project_id: null,
          project_emoji: "",
          parent: null,
          cycle_id: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        });
      if (String(path).endsWith("/assignees")) return json({ assignees: [] });
      throw Error("Unexpected request: " + path);
    }),
  );
  render(
    <CapabilitiesProvider slug="demo">
      <IssuePage identifier="AL-1" teams={[]} />
    </CapabilitiesProvider>,
  );
  expect(await screen.findByRole("heading", { name: "Migrated issue" })).toBeTruthy();
  expect(
    screen.getByText("Comments and agent work logs have not been migrated to Roster yet."),
  ).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
  expect(screen.queryByText("No project")).toBeNull();
  expect(
    calls.some((path) => /\/(projects|labels|label-groups|cycles|work-logs)(?:[/?]|$)/.test(path)),
  ).toBe(false);
});
