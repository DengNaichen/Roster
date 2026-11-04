import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Spec, SpecContent } from "../../../packages/contracts/spec";
import SpecPage from "./SpecPage";
import SpecsPage from "./SpecsPage";
import SpecDocument from "./SpecDocument";
import { SpecHistory } from "./SpecHistory";
import { compareSpecContent, rebaseSpecDraft, specView } from "./specView";
import { fixtureIssue, json } from "./test/fixtures";
import { workspaceRoute } from "./shared";
vi.mock("./shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shared")>();
  return {
    ...actual,
    api: async (path: string, method = "GET", body?: object) => {
      const response = await fetch(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw Object.assign(
          new Error(typeof data.error === "string" ? data.error : data.error.message),
          { status: response.status, code: data.error?.code },
        );
      }
      return data;
    },
  };
});
const content: SpecContent = {
  title: "Real specification",
  status: "draft",
  branch: "feature/specs",
  stories: [
    {
      id: "US-1",
      title: "Read a spec",
      priority: "P1",
      description: "See current content",
      why: "Shared understanding",
      independent_test: "Open its page",
      scenarios: [
        {
          given: "A saved spec",
          when: "The page opens",
          then: "Its content is visible",
        },
      ],
    },
  ],
  edge_cases: ["Concurrent edits"],
  requirements: [
    {
      id: "FR-001",
      text: "Persist revisions",
      clarify: "Retention policy",
    },
  ],
  entities: [{ name: "Revision", description: "Immutable snapshot" }],
  success_criteria: [{ id: "SC-001", text: "No lost updates" }],
  clarifications: [
    {
      date: "2026-11-01",
      items: [{ question: "Source of truth?", answer: "The shared service" }],
    },
  ],
};
const spec: Spec = {
  active_revision: null,
  issue_progress: { done: 0, total: 0 },
  identifier: "SPEC-42",
  team: "AL",
  revision: 1,
  message: "Initial",
  author: { subject: "person", name: "Ada", email: "ada@example.test" },
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
  content,
};
const team = {
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
beforeEach(() => {
  history.replaceState(null, "", "/demo/spec/SPEC-42");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
it("retains prototype template section order, title and persisted creation date", () => {
  render(<SpecDocument spec={specView(content, spec.created_at)} />);
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
    "User Scenarios & Testing",
    "Requirements",
    "Success Criteria",
    "Clarifications",
  ]);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(content.title);
  expect(screen.getByText("2026-11-01")).toBeTruthy();
});
it("retains prioritized story notes and Given/When/Then scenarios", () => {
  render(<SpecDocument spec={specView(content, spec.created_at)} />);
  const story = screen.getByRole("region", { name: "US-1 Read a spec" });
  expect(within(story).getByText("P1")).toBeTruthy();
  expect(within(story).getByText("Open its page")).toBeTruthy();
  for (const word of ["Given", "When", "Then"]) {
    expect(within(story).getByText(word)).toBeTruthy();
  }
});
it("renders stable FR/SC IDs with clarification markers", () => {
  render(<SpecDocument spec={specView(content, spec.created_at)} />);
  expect(document.querySelector("#FR-001 .spec-clarify")?.textContent).toContain(
    "Retention policy",
  );
  expect(document.querySelector("#SC-001")?.textContent).toContain("No lost updates");
});
it("preserves clarification question/answer sessions", () => {
  render(<SpecDocument spec={specView(content, spec.created_at)} />);
  expect(screen.getByText("Session 2026-11-01")).toBeTruthy();
  expect(screen.getByText("The shared service")).toBeTruthy();
});
it("matches revisions by stable IDs, independent of order, retaining removed entries", () => {
  const before = {
    ...content,
    requirements: [
      { id: "FR-001", text: "Old text" },
      {
        id: "FR-002",
        text: "Removed",
      },
    ],
  };
  const after = {
    ...content,
    requirements: [
      { id: "FR-003", text: "Added" },
      {
        id: "FR-001",
        text: "New text",
      },
    ],
  };
  expect(
    compareSpecContent(before, after)
      .filter((entry) => entry.section === "Requirement")
      .map((entry) => [entry.id, entry.kind]),
  ).toEqual([
    ["FR-001", "changed"],
    ["FR-002", "removed"],
    ["FR-003", "added"],
  ]);
  expect(
    compareSpecContent(before, {
      ...before,
      requirements: [...before.requirements].reverse(),
    })
      .filter((entry) => entry.section === "Requirement")
      .every((entry) => entry.kind === "unchanged"),
  ).toBe(true);
});
it("retains drafts through conflicts and requires explicit latest-revision review before retry", async () => {
  const writes: { base_revision: number; content: SpecContent }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path.includes("/issues?")) return json({ issues: [] });
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push(body);
        return writes.length === 1
          ? json(
              {
                error: { code: "conflict", message: "Spec revision conflict" },
              },
              409,
            )
          : json({ ...spec, revision: 3, content: body.content });
      }
      return json(
        writes.length > 0
          ? {
              ...spec,
              revision: 2,
              content: { ...content, title: "Server changed title" },
            }
          : spec,
      );
    }),
  );
  render(<SpecPage id="SPEC-42" />);
  await screen.findByRole("heading", { name: content.title });
  fireEvent.click(screen.getByRole("button", { name: "Edit spec" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: "My unsaved title" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
  expect(await screen.findByText(/The server has a newer revision/)).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
    "My unsaved title",
  );
  expect(writes[0].base_revision).toBe(1);
  expect(writes[0].content.stories).toEqual(content.stories);
  expect(
    (screen.getByRole("button", { name: "Save revision" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Review latest revision" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Use revision 2 as base, keep my draft",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
  expect(await screen.findByRole("heading", { name: "My unsaved title", level: 1 })).toBeTruthy();
  expect(writes[1].base_revision).toBe(2);
});
it("opens the active revision while a proposed replacement is in review", async () => {
  const active = { ...content, title: "Current agreement", status: "active" };
  const proposed = { ...content, title: "Proposed change", status: "review" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path.includes("/issues?")) return json({ issues: [] });
      if (path.endsWith("/revisions/1")) return json({ number: 1, content: active });
      return json({
        ...spec,
        revision: 2,
        active_revision: { number: 1, title: active.title },
        content: proposed,
      });
    }),
  );
  render(<SpecPage id={spec.identifier} />);
  expect(await screen.findByRole("heading", { level: 1, name: active.title })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /r2 · In review/ }));
  expect(await screen.findByRole("heading", { level: 1, name: proposed.title })).toBeTruthy();
});
it("reads immutable history and compares stable requirements", async () => {
  const old = {
    ...content,
    requirements: [
      { id: "FR-001", text: "Old text" },
      {
        id: "FR-002",
        text: "Removed text",
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path.endsWith("/revisions")) {
        return json({
          revisions: [2, 1].map((number) => ({
            number,
            message: "Saved",
            author: spec.author,
            created_at: spec.created_at,
          })),
        });
      }
      if (/\/revisions\/[12]$/.test(path)) {
        return json({
          number: Number(path.slice(-1)),
          content: path.endsWith("/1") ? old : content,
          message: "Saved revision",
          author: spec.author,
          created_at: spec.created_at,
        });
      }
      return json({ ...spec, revision: 2 });
    }),
  );
  render(<SpecHistory spec={{ ...spec, revision: 2 }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Compare revisions" }));
  expect(
    await screen.findByRole("heading", {
      name: "Requirement FR-001 · changed",
    }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Requirement FR-002 · removed" })).toBeTruthy();
});
it("shows spec titles and counts by team before any selection", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ specs: [{ ...spec, title: content.title, status: "draft" }] })),
  );
  render(<SpecsPage team="" teams={[team, { ...team, key: "OPS", name: "Operations" }]} />);
  const populated = await screen.findByRole("region", { name: team.name });
  const toggle = within(populated).getByRole("button", { name: team.name + ", 1 spec" });
  expect(within(populated).getByRole("link", { name: /Real specification/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Operations, 0 specs" })).toBeTruthy();
  fireEvent.click(toggle);
  expect(within(populated).queryByRole("link")).toBeNull();
});
it("creates using REST and navigates to the returned identifier", async () => {
  history.replaceState(null, "", "/demo/specs");
  let created: { team: string; content: SpecContent } | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        created = JSON.parse(String(init.body));
        return json({ ...spec, content: created!.content });
      }
      return json({ specs: [] });
    }),
  );
  render(<SpecsPage team="AL" teams={[team]} />);
  await screen.findByText("No specs yet.");
  fireEvent.click(screen.getByRole("button", { name: "New spec" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: "Created via UI" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create spec" }));
  await waitFor(() => expect(window.location.pathname).toBe("/demo/spec/SPEC-42"));
  expect(created?.team).toBe("AL");
  expect(created?.content.title).toBe("Created via UI");
  expect(workspaceRoute("/demo/specs")).toEqual({ kind: "specs", team: "" });
  expect(workspaceRoute("/demo/spec/SPEC-42")).toEqual({
    kind: "spec",
    identifier: "SPEC-42",
  });
});
it("retries missing/forbidden reads without substituting prototype content", async () => {
  let failed = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path.includes("/issues?")
        ? json({ issues: [] })
        : failed
          ? json({ error: "Spec not found" }, 404)
          : json(spec),
    ),
  );
  render(<SpecPage id="SPEC-42" />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Spec not found");
  expect(screen.queryByRole("heading", { name: content.title })).toBeNull();
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry spec" }));
  expect(await screen.findByRole("heading", { name: content.title })).toBeTruthy();
});

it("rebases only form edits while preserving newer server content in untouched sections", () => {
  const draft = { ...content, title: "My title" };
  const latest = {
    ...content,
    stories: [{ ...content.stories[0], description: "Server story edit" }],
    requirements: [{ id: "FR-099", text: "Server requirement" }],
  };
  const merged = rebaseSpecDraft(content, draft, latest);
  expect(merged.title).toBe("My title");
  expect(merged.stories).toEqual(latest.stories);
  expect(merged.requirements).toEqual(latest.requirements);
});

it("keeps independently added server IDs when a reviewed draft edits another requirement", () => {
  const draft = {
    ...content,
    requirements: [{ ...content.requirements[0], text: "My requirement edit" }],
  };
  const latest = {
    ...content,
    requirements: [
      ...content.requirements,
      {
        id: "FR-002",
        text: "Added on server",
      },
    ],
  };
  const merged = rebaseSpecDraft(content, draft, latest);
  expect(merged.requirements.map((entry) => entry.id)).toEqual(["FR-001", "FR-002"]);
  expect(merged.requirements[0].text).toBe("My requirement edit");
});

it("loads real scoped links beyond 50 rows and persists link/unlink through remounts", async () => {
  const fixtures = Array.from({ length: 55 }, (_, i) => ({
    ...fixtureIssue,
    identifier: `AL-${i + 1}`,
    title: `Linked issue ${i + 1}`,
    status: i % 2 === 0 ? "todo" : "in_progress",
  }));
  const candidate = { ...fixtureIssue, identifier: "AL-100", title: "Existing candidate" };
  let linked = fixtures;
  const writes: { method: string; issues: string[] }[] = [];
  let failUnlink = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (
        path.endsWith("/specs/SPEC-42/issues") &&
        ["POST", "DELETE"].includes(init?.method ?? "")
      ) {
        const { issues } = JSON.parse(String(init?.body));
        writes.push({ method: init!.method!, issues });
        if (init?.method === "DELETE") {
          if (failUnlink) return json({ error: "Cannot unlink right now" }, 500);
          linked = linked.filter((i) => !issues.includes(i.identifier));
        } else linked = [...linked, candidate];
        return json({ identifier: "SPEC-42", issues, linked: init?.method === "POST" });
      }
      if (path.includes("/specs/SPEC-42/issues?")) {
        expect(path).toContain("limit=-1");
        return json({ issues: linked });
      }
      if (path.includes("/issues?")) return json({ issues: [...fixtures, candidate] });
      if (path.endsWith("/teams")) return json({ teams: [team] });
      if (path.endsWith("/labels")) return json({ labels: [], groups: [] });
      if (path.endsWith("/label-groups")) return json({ groups: [] });
      return json(spec);
    }),
  );
  const mounted = render(<SpecPage id="SPEC-42" />);
  fireEvent.click(await screen.findByRole("tab", { name: "Issues · 55" }));
  expect(await screen.findByText("Linked issue 55")).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select AL-1" }));
  failUnlink = true;
  fireEvent.click(screen.getByRole("button", { name: "Unlink from spec" }));
  expect(await screen.findByText("Cannot unlink right now")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Issues · 55" })).toBeTruthy();
  failUnlink = false;
  fireEvent.click(screen.getByRole("button", { name: "Unlink from spec" }));
  await screen.findByRole("tab", { name: "Issues · 54" });
  fireEvent.click(screen.getByRole("button", { name: "Link issues" }));
  const dialog = await screen.findByRole("dialog", { name: "Link issues" });
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "Existing candidate" },
  });
  fireEvent.click(await within(dialog).findByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Link 1 issues" }));
  await screen.findByRole("tab", { name: "Issues · 55" });
  expect(await screen.findByText("Existing candidate")).toBeTruthy();
  expect(writes).toEqual([
    { method: "DELETE", issues: ["AL-1"] },
    { method: "DELETE", issues: ["AL-1"] },
    { method: "POST", issues: ["AL-100"] },
  ]);
  mounted.unmount();
  render(<SpecPage id="SPEC-42" />);
  fireEvent.click(await screen.findByRole("tab", { name: "Issues · 55" }));
  expect(await screen.findByText("Existing candidate")).toBeTruthy();
  expect(screen.queryByText("Linked issue 1")).toBeNull();
});
it("reopens a browser-local design from the section URL without modifying the spec", async () => {
  const read = vi.fn(async (path: string) =>
    json(path.includes("/issues?") ? { issues: [] } : spec),
  );
  vi.stubGlobal("fetch", read);
  const view = render(<SpecPage id={spec.identifier} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Design" }));
  fireEvent.click(screen.getByRole("button", { name: "New design" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Decision title" }), {
    target: { value: "Verify handoff" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Reason and alternatives" }), {
    target: { value: "Keep records independent" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save design" }));
  view.unmount();
  expect(location.search).toBe("?section=design");
  render(<SpecPage id={spec.identifier} />);
  expect(await screen.findByText("Verify handoff")).toBeTruthy();
  expect(screen.getByText("Keep records independent")).toBeTruthy();
  expect(screen.getByText("Based on spec r1")).toBeTruthy();
  for (const call of read.mock.calls as unknown as [string, RequestInit][])
    expect(call[1]?.method ?? "GET").toBe("GET");
});
