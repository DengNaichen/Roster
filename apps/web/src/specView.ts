import type { SpecContent } from "../../../packages/contracts/spec";
export type SpecView =
  & Omit<SpecContent, "edge_cases" | "success_criteria" | "stories">
  & {
    created: string;
    edgeCases: string[];
    successCriteria: SpecContent["success_criteria"];
    stories: (SpecContent["stories"][number] & { independentTest: string })[];
  };
export function specView(content: SpecContent, createdAt: string): SpecView {
  return {
    ...content,
    created: createdAt.slice(0, 10),
    stories: content.stories.map((story) => ({
      ...story,
      independentTest: story.independent_test,
    })),
    edgeCases: content.edge_cases,
    successCriteria: content.success_criteria,
  };
}
export function emptySpec(): SpecContent {
  return {
    title: "",
    status: "draft",
    branch: "",
    stories: [],
    edge_cases: [],
    requirements: [],
    entities: [],
    success_criteria: [],
    clarifications: [],
  };
}
export type SpecDifference = {
  section: "User story" | "Requirement" | "Success criterion";
  id: string;
  kind: "added" | "changed" | "removed" | "unchanged";
  before: string;
  after: string;
};
function text(entry: object): string {
  if ("text" in entry) {
    return String(entry.text) +
      ("clarify" in entry && entry.clarify
        ? ` [NEEDS CLARIFICATION: ${entry.clarify}]`
        : "");
  }
  const story = entry as SpecContent["stories"][number];
  return [
    story.title,
    story.priority,
    story.description,
    story.why,
    story.independent_test,
    ...story.scenarios.map((scenario) =>
      `Given ${scenario.given}; When ${scenario.when}; Then ${scenario.then}`
    ),
  ].join("\n");
}
export function compareSpecContent(
  before: SpecContent,
  after: SpecContent,
): SpecDifference[] {
  const result: SpecDifference[] = [];
  for (
    const [key, section] of [["stories", "User story"], [
      "requirements",
      "Requirement",
    ], ["success_criteria", "Success criterion"]] as const
  ) {
    const oldEntries = new Map(
      before[key].map((entry) => [entry.id, entry] as const),
    );
    const newEntries = new Map(
      after[key].map((entry) => [entry.id, entry] as const),
    );
    for (const id of new Set([...oldEntries.keys(), ...newEntries.keys()])) {
      const old = oldEntries.get(id), current = newEntries.get(id);
      result.push({
        section,
        id,
        kind: !old
          ? "added"
          : !current
          ? "removed"
          : JSON.stringify(old) === JSON.stringify(current)
          ? "unchanged"
          : "changed",
        before: old ? text(old) : "",
        after: current ? text(current) : "",
      });
    }
  }
  return result;
}

function mergeStableEntries<T extends { id: string }>(
  base: T[],
  draft: T[],
  latest: T[],
): T[] {
  const old = new Map(base.map((entry) => [entry.id, entry]));
  const edited = new Map(draft.map((entry) => [entry.id, entry]));
  const merged = new Map(
    latest.map((entry) => [entry.id, structuredClone(entry)]),
  );
  for (const entry of base) {
    const change = edited.get(entry.id);
    if (!change) merged.delete(entry.id);
    else if (JSON.stringify(change) !== JSON.stringify(entry)) {
      merged.set(entry.id, structuredClone(change));
    }
  }
  for (const entry of draft) {
    if (!old.has(entry.id)) merged.set(entry.id, structuredClone(entry));
  }
  return [...merged.values()];
}
/** Only explicitly edited fields and stable-ID entries override a reviewed base. */
export function rebaseSpecDraft(
  base: SpecContent,
  draft: SpecContent,
  latest: SpecContent,
): SpecContent {
  return {
    ...structuredClone(latest),
    title: base.title !== draft.title ? draft.title : latest.title,
    status: base.status !== draft.status ? draft.status : latest.status,
    branch: base.branch !== draft.branch ? draft.branch : latest.branch,
    requirements: mergeStableEntries(
      base.requirements,
      draft.requirements,
      latest.requirements,
    ),
    success_criteria: mergeStableEntries(
      base.success_criteria,
      draft.success_criteria,
      latest.success_criteria,
    ),
  };
}
