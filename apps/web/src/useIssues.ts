import { useResource } from "./useResource";
import { LabelFilterValue } from "./useLabels";
import { apiPath, Priority } from "./shared";
import { useRequestScope } from "./useRequestScope";

import { type IssueList } from "./issueCache";
import { useIssueMutations } from "./issueMutations";

export type IssueQuery = {
  specIdentifier?: string;
  cycleID?: number;
  assignee?: string;
  projectID?: number;
  team: string;
  type: string;
  query: string;
  priority: Priority | "";
  labelFilter: LabelFilterValue;
};

export function useIssues(
  {
    cycleID,
    projectID,
    team,
    type,
    query,
    priority,
    labelFilter,
    assignee = "",
    specIdentifier,
  }: IssueQuery,
  setError: (message: string) => void,
) {
  const params = new URLSearchParams({ query, label_mode: labelFilter.mode });
  if (assignee === "me") params.set("assigned_to_me", "true");
  else if (assignee) params.set("assignee", assignee === "unassigned" ? "" : assignee.slice(5));
  if (cycleID !== undefined) params.set("cycle_id", String(cycleID));
  if (projectID !== undefined) params.set("project_id", String(projectID));
  if (team) params.set("team", team);
  if (type) params.set("type", type);
  if (priority !== "") params.set("priority", String(priority));
  labelFilter.labels.forEach((id) => params.append("label_id", String(id)));
  labelFilter.groups.forEach((id) => params.append("label_group_id", String(id)));
  if (specIdentifier) params.set("limit", "-1");
  const path = apiPath(
    specIdentifier
      ? `/specs/${encodeURIComponent(specIdentifier)}/issues?${params}`
      : `/issues?${params}`,
  );
  const requests = useRequestScope(apiPath("/issues"));
  const resource = useResource<IssueList>(path, { issues: [] });
  const mutations = useIssueMutations(apiPath("/issues"), setError);
  return {
    issues: resource.data.issues,
    loading: resource.loading,
    loadError: resource.error,
    loadIssues: resource.reload,
    ...mutations,
    writeLabels: requests.write,
  };
}
