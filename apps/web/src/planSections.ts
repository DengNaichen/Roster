// The implementation plan and its Phase 0/1 artifacts share a browser-local form.
export const planSections = [
  {
    title: "Technical context",
    artifact: "plan.md",
    fields: [
      [
        "stack",
        "Language, dependencies and platform",
        "Name the runtime, libraries and target environment.",
      ],
      ["storage", "Storage and testing", "Describe persistence and the test strategy."],
      [
        "constraints",
        "Performance, constraints and scope",
        "Mark open questions NEEDS CLARIFICATION.",
      ],
    ],
  },
  {
    title: "Constitution check",
    artifact: "plan.md",
    fields: [
      [
        "initialCheck",
        "Before research",
        "Record applicable project principles and the result of each check.",
      ],
      [
        "exceptions",
        "Complexity tracking",
        "Justify exceptions and explain why simpler alternatives are insufficient.",
      ],
    ],
  },
  {
    title: "Project structure",
    artifact: "plan.md",
    fields: [
      ["structure", "Affected paths", "List the directories involved and explain the choice."],
    ],
  },
  {
    title: "Phase 0 · Research",
    artifact: "research.md",
    fields: [
      ["decision", "Decision", "Resolve an open technical question."],
      ["rationale", "Rationale", "Explain why the chosen approach fits the spec."],
      ["alternatives", "Alternatives considered", "Record the alternatives and their trade-offs."],
    ],
  },
  {
    title: "Phase 1 · Design and contracts",
    artifact: "data-model.md · contracts/",
    fields: [
      ["model", "Data model", "Describe entities, relationships, validation and transitions."],
      [
        "contracts",
        "Interface contracts",
        "Describe inputs, outputs and failure behavior, or explain why this is internal.",
      ],
    ],
  },
  {
    title: "Phase 1 · Quickstart",
    artifact: "quickstart.md",
    fields: [
      ["quickstart", "Validation steps", "Give prerequisites, steps and expected results."],
      [
        "finalCheck",
        "Post-design constitution check",
        "Revisit the original checks against the proposed design.",
      ],
    ],
  },
] as const;
export type PlanNotes = Partial<Record<(typeof planSections)[number]["fields"][number][0], string>>;
