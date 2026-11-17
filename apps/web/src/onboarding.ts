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

export { deriveTeamKey } from "../../../packages/contracts/workspace.ts";

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
