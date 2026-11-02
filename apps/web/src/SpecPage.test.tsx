import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Spec, SpecContent } from "../../../packages/contracts/spec";
import SpecPage from "./SpecPage";
import SpecsPage from "./SpecsPage";
import SpecDocument from "./SpecDocument";
import { compareSpecContent, rebaseSpecDraft, specView } from "./specView";
import { json } from "./test/fixtures";
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
    vi.fn(async (_path: string, init?: RequestInit) => {
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
  render(<SpecPage id="SPEC-42" />);
  fireEvent.click(await screen.findByRole("button", { name: "Revision history" }));
  fireEvent.click(await screen.findByRole("button", { name: "Compare revisions" }));
  expect(
    await screen.findByRole("heading", {
      name: "Requirement FR-001 · changed",
    }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Requirement FR-002 · removed" })).toBeTruthy();
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
  await screen.findByText("No specs in this scope yet.");
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
    vi.fn(async () => (failed ? json({ error: "Spec not found" }, 404) : json(spec))),
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
