export type Scenario = { given: string; when: string; then: string };
export type DesignContent = {
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
    "Track each linked pull request independently. Re-evaluate the issue after each merge event.",
  sequence: `sequenceDiagram
  participant GitHub
  participant Roster
  participant Issue
  GitHub->>Roster: Pull request merged
  Roster->>Roster: Read all linked pull requests
  alt All merged
    Roster->>Issue: Mark eligible issue done
  else Another PR is open
    Roster-->>Issue: Keep in review
  end`,
  state: `stateDiagram-v2
  InReview --> InReview: Another PR is open
  InReview --> Done: All PRs merged
  InReview --> Canceled: Manually canceled`,
  scenarios: [
    {
      given: "An issue in review has two open pull requests.",
      when: "The first pull request merges.",
      then: "The issue stays in review.",
    },
    {
      given: "One linked pull request is still open.",
      when: "The same merge event arrives again.",
      then: "The issue state remains unchanged.",
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
    !Array.isArray(c.scenarios) ||
    !c.scenarios.every(
      (s: Scenario) => s && [s.given, s.when, s.then].every((v) => typeof v === "string"),
    )
  )
    throw new Error("Invalid design content");
  return value;
}
