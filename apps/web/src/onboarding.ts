import type { IssueScope, Status } from "./shared";

/**
 * Derive a valid URL slug (`[a-z][a-z0-9-]{1,31}`) from a workspace display name.
 * Returns "" when the name has fewer than two usable ASCII characters so the
 * user can type an explicit slug instead of receiving invalid filler.
 */
export function deriveWorkspaceSlug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+/g, "-")
    .slice(0, 32)
    .replace(/-+$/, "");
  return /^[a-z][a-z0-9-]{1,31}$/.test(cleaned) ? cleaned : "";
}

/**
 * Derive a valid team key (`[A-Z][A-Z0-9]{1,5}`) from a team display name.
 * Multi-word names use initials (or keep a short leading acronym); single words
 * use the first 2–3 characters.
 */
export function deriveTeamKey(name: string): string {
  const words = name
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  let candidate: string;
  if (words.length === 1) {
    candidate = words[0]
      .toUpperCase()
      .replace(/^[^A-Z]+/, "")
      .slice(0, 3);
  } else {
    const first = words[0];
    if (/^[A-Z][A-Z0-9]{1,3}$/.test(first)) {
      candidate = first;
    } else {
      candidate = words
        .map((word) => word[0].toUpperCase())
        .join("")
        .replace(/^[^A-Z]+/, "")
        .slice(0, 4);
      if (candidate.length < 2) {
        candidate = words
          .join("")
          .toUpperCase()
          .replace(/^[^A-Z]+/, "")
          .slice(0, 3);
      }
    }
  }
  return /^[A-Z][A-Z0-9]{1,5}$/.test(candidate) ? candidate : "";
}

/**
 * Choose a default status for a new issue that matches the list the user is
 * currently viewing, so newly created issues do not disappear into Triage when
 * created from Active, Backlog, All issues, Projects, or Cycles.
 */
export function defaultIssueStatus(
  triage: boolean,
  filter: Status | "all",
  scope: IssueScope,
): Status {
  if (triage) return "triage";
  if (filter !== "all") return filter;
  if (scope === "backlog") return "backlog";
  return "todo";
}
