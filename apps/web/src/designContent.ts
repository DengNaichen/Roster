import { planSections, type PlanNotes } from "./planSections";
export type Scenario = { given: string; when: string; then: string };
export type DesignContent = {
  plan?: PlanNotes;
  approach: string;
  sequence: string;
  state: string;
  scenarios: Scenario[];
};
export type Design = { content: DesignContent; revision: number };
export const blankScenario = { given: "", when: "", then: "" };
export const emptyDesign: DesignContent = { approach: "", sequence: "", state: "", scenarios: [] };
export const exampleDesign: DesignContent = {
  approach:
    "Keep specifications and issues independent. Store their relationship separately so either record can evolve on its own.",
  plan: {
    stack: "TypeScript web client and service, with PostgreSQL for persistent links.",
    storage:
      "Store a unique pair of spec and issue IDs. Exercise permissions, duplicate links and unlinking in integration tests.",
    constraints: "Both records must belong to the same workspace and remain visible to the caller.",
    initialCheck:
      "Example review criterion: enforce workspace and team visibility at both ends of the relationship.",
    exceptions: "No exception proposed.",
    structure:
      "packages/backend for link operations, packages/contracts for shared inputs, apps/web for both directions of navigation.",
    decision: "Use a many-to-many association.",
    rationale: "One implementation task can support several specifications.",
    alternatives: "A single spec ID on the issue would prevent reuse across specs.",
    model: "Spec and Issue each have an independent lifecycle. A unique link identifies one pair.",
    contracts:
      "Link and unlink by identifier. Check both records before writing. Repeating a link keeps a single association.",
    quickstart:
      "Open a visible spec, link an existing issue, refresh both detail pages, then unlink. Verify both records still exist.",
    finalCheck:
      "Review the read and write paths with a private-team issue before handing off implementation.",
  },
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
  scenarios: [
    {
      given: "A spec and issue are linked.",
      when: "A member unlinks the issue.",
      then: "Both records remain available and the association disappears.",
    },
  ],
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
  if (typeof value.body === "string")
    return { revision: value.revision, content: fromMarkdown(value.body) };
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
  return value;
}
