import { planSections, type PlanNotes } from "./planSections";
export type Scenario = { given: string; when: string; then: string };
export type DesignContent = {
  notes?: string;
  approach: string;
  sequence: string;
  state: string;
  scenarios: Scenario[];
};
export type Design = { content: DesignContent; revision: number };
export const blankScenario = { given: "", when: "", then: "" };
export const emptyDesign: DesignContent = { approach: "", sequence: "", state: "", scenarios: [] };
export const exampleDesign: DesignContent = {
  approach: [
    "Keep the spec and the issue independent. Removing a link must preserve both records.",
    "Check access to both records before exposing or changing their relationship.",
    "Keep one link per spec–issue pair, even when two callers link the pair concurrently.",
    "Apply the same visibility and uniqueness rules to actions from the web and MCP.",
  ].join("\n"),
  sequence: `sequenceDiagram
  actor User
  participant Roster
  participant Store
  User->>Roster: Link issue to spec
  Roster->>Store: Check access to both records
  alt Both visible
    Roster->>Store: Ensure unique link
    Roster-->>User: Show linked issue
  else Access denied
    Roster-->>User: Reject link
  end`,
  state: `stateDiagram-v2
  [*] --> Unlinked
  Unlinked --> Linked: Link visible pair
  Linked --> Linked: Repeat link
  Linked --> Unlinked: Unlink`,
  scenarios: [],
};

// Import the original four-section template. Preserve arbitrary Markdown verbatim
// in Approach when it doesn't match, so a failed conversion never loses text.
function fromMarkdown(body: string): DesignContent {
  const match =
    /^## Approach\s*\n([\s\S]*?)\n## Sequence\s*\n```mermaid\n([\s\S]*?)\n```\s*\n## State transitions\s*\n```mermaid\n([\s\S]*?)\n```\s*\n## Verification\s*\n([\s\S]*)$/.exec(
      body,
    );
  if (!match) return { ...emptyDesign, approach: body };
  return {
    approach: match[1].trim(),
    sequence: match[2],
    state: match[3],
    scenarios: [{ ...blankScenario, then: match[4].trim() }],
  };
}
export function readDesign(key: string): Design | null {
  const value = JSON.parse(localStorage.getItem(key) ?? "null");
  if (value === null) return null;
  if (!Number.isInteger(value.revision)) throw new Error("Invalid design revision");
  if (typeof value.body === "string") value.content = fromMarkdown(value.body);
  const c = value.content;
  if (
    !c ||
    [c.approach, c.sequence, c.state].some((v) => typeof v !== "string") ||
    (c.plan !== undefined &&
      (!c.plan ||
        typeof c.plan !== "object" ||
        Array.isArray(c.plan) ||
        planSections.some((section) =>
          section.fields.some(
            ([key]) => c.plan[key] !== undefined && typeof c.plan[key] !== "string",
          ),
        ))) ||
    !Array.isArray(c.scenarios) ||
    !c.scenarios.every(
      (s: Scenario) => s && [s.given, s.when, s.then].every((v) => typeof v === "string"),
    )
  )
    throw new Error("Invalid design content");
  if (c.notes !== undefined && typeof c.notes !== "string") throw new Error("Invalid design notes");
  if (c.plan || c.scenarios.length) {
    const notes = [c.notes];
    const plan: PlanNotes = c.plan ?? {};
    for (const section of planSections)
      for (const [key, label] of section.fields) {
        if (plan[key]) notes.push(label + "\n" + plan[key]);
      }
    for (const scenario of c.scenarios as Scenario[]) {
      notes.push(
        [
          ["Given", scenario.given],
          ["When", scenario.when],
          ["Then", scenario.then],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => k + " " + v)
          .join("\n"),
      );
    }
    return {
      revision: value.revision,
      content: {
        approach: c.approach,
        sequence: c.sequence,
        state: c.state,
        scenarios: [],
        notes: notes.filter(Boolean).join("\n\n"),
      },
    };
  }
  return value;
}
