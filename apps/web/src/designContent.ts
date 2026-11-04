import { planSections, type PlanNotes } from "./planSections";
export type Scenario = { given: string; when: string; then: string };
type LegacyContent = {
  notes?: string;
  approach: string;
  sequence: string;
  state: string;
  scenarios: Scenario[];
};
import type { StoredDesign } from "../../../packages/contracts/spec";
export type DesignContent = StoredDesign["content"];
type Decision = DesignContent["decisions"][number];
export type Design = { content: DesignContent; revision: number };
export const blankDecision: Decision = { title: "", reason: "", sequence: "", state: "" };
export const emptyDesign: DesignContent = {
  context: "",
  goals: "",
  nonGoals: "",
  risks: "",
  decisions: [blankDecision],
};
const blankScenario = { given: "", when: "", then: "" };
// Import the original four-section template. Preserve arbitrary Markdown verbatim
// in Approach when it doesn't match, so a failed conversion never loses text.
function fromMarkdown(body: string): LegacyContent {
  const match =
    /^## Approach\s*\n([\s\S]*?)\n## Sequence\s*\n```mermaid\n([\s\S]*?)\n```\s*\n## State transitions\s*\n```mermaid\n([\s\S]*?)\n```\s*\n## Verification\s*\n([\s\S]*)$/.exec(
      body,
    );
  if (!match) return { approach: body, sequence: "", state: "", scenarios: [] };
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
  if (Array.isArray(c?.decisions)) {
    if (
      [c.context, c.goals, c.nonGoals, c.risks, c.notes ?? ""].some((v) => typeof v !== "string") ||
      !c.decisions.every(
        (d: Decision) =>
          d && [d.title, d.reason, d.sequence, d.state].every((v) => typeof v === "string"),
      )
    )
      throw new Error("Invalid design");
    return value;
  }
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
  {
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
        ...emptyDesign,
        decisions: (c.approach.split(/\r?\n/).filter((line: string) => line.trim()).length
          ? c.approach.split(/\r?\n/).filter((line: string) => line.trim())
          : [""]
        ).map((title: string, index: number) => ({
          ...blankDecision,
          title,
          sequence: index === 0 ? c.sequence : "",
          state: index === 0 ? c.state : "",
        })),
        notes: notes.filter(Boolean).join("\n\n"),
      },
    };
  }
}
