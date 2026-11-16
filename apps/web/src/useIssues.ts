import { useResource } from "./useResource";
import { useCallback, useEffect, useRef, useState } from "react";
import { LabelFilterValue } from "./useLabels";
import { api, apiPath, Issue, IssueSummary, Priority, Status } from "./shared";
import { useRequestScope } from "./useRequestScope";

type IssueList = { issues: IssueSummary[] };

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
  const confirmedStatuses = useRef(new Map<string, Status>());
  const pendingStatuses = useRef(new Map<string, { status: Status; revision: number }>());
  const revision = useRef(0);
  const [savingPriorities, setSavingPriorities] = useState<string[]>([]);
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
  // The write queue belongs to the mounted page, across changes to its filters.
  const requests = useRequestScope(apiPath("/issues"));
  const resource = useResource<IssueList>(path, { issues: [] });
  const currentPath = useRef(path);
  currentPath.current = path;
  const [local, setLocal] = useState<{
    path: string;
    base: IssueList;
    issues: IssueSummary[];
  } | null>(null);
  const baseIssues =
    local?.path === path && local.base === resource.data ? local.issues : resource.data.issues;
  const issues = baseIssues.map((issue) =>
    pendingStatuses.current.has(issue.identifier)
      ? { ...issue, status: pendingStatuses.current.get(issue.identifier)!.status }
      : issue,
  );
  const setIssues = useCallback(
    (change: (items: IssueSummary[]) => IssueSummary[]) => {
      setLocal((previous) => ({
        path,
        base: resource.data,
        issues: change(
          previous?.path === path && previous.base === resource.data
            ? previous.issues
            : resource.data.issues,
        ),
      }));
    },
    [path, resource.data],
  );
  useEffect(() => {
    resource.data.issues.forEach((issue) =>
      confirmedStatuses.current.set(issue.identifier, issue.status),
    );
  }, [resource.data]);
  const { reload: loadIssues, loading, error: loadError } = resource;

  async function moveIssue(identifier: string, status: Status) {
    const started = ++revision.current;
    pendingStatuses.current.set(identifier, { status, revision: started });
    const previous = issues.find((issue) => issue.identifier === identifier)?.status;
    setIssues((items) =>
      items.map((issue) => (issue.identifier === identifier ? { ...issue, status } : issue)),
    );
    const url = apiPath(`/issues/${identifier}/status`);
    await requests.write(
      identifier,
      () => api<Issue>(url, "PATCH", { status }),
      (updated) => {
        if (pendingStatuses.current.get(identifier)?.revision === started)
          pendingStatuses.current.delete(identifier);
        const { document: _document, ...summary } = updated;
        confirmedStatuses.current.set(identifier, updated.status);
        resource.update((current) => ({
          ...current,
          issues: current.issues.map((issue) =>
            issue.identifier === identifier ? summary : issue,
          ),
        }));
        if (currentPath.current === path)
          setIssues((items) =>
            items.map((issue) => (issue.identifier === identifier ? summary : issue)),
          );
      },
      (cause) => {
        if (pendingStatuses.current.get(identifier)?.revision !== started) return;
        pendingStatuses.current.delete(identifier);
        if (currentPath.current !== path) return;
        const restored = confirmedStatuses.current.get(identifier) ?? previous;
        if (restored)
          setIssues((items) =>
            items.map((issue) =>
              issue.identifier === identifier ? { ...issue, status: restored } : issue,
            ),
          );
        setError(cause.message);
      },
    );
    await loadIssues();
  }

  async function changePriority(identifier: string, next: Priority) {
    setSavingPriorities((items) => [...items, identifier]);
    setError("");
    const url = apiPath(`/issues/${identifier}`);
    await requests.write(
      identifier,
      () => api<Issue>(url, "PATCH", { priority: next }),
      (updated) => {
        const { document: _document, ...summary } = updated;
        confirmedStatuses.current.set(identifier, updated.status);
        resource.update((current) => ({
          ...current,
          issues: current.issues.map((issue) =>
            issue.identifier === identifier ? summary : issue,
          ),
        }));
        if (currentPath.current === path)
          setIssues((items) =>
            items.map((issue) => (issue.identifier === identifier ? summary : issue)),
          );
      },
      (cause) => {
        if (currentPath.current === path) setError(cause.message);
      },
    );
    setSavingPriorities((items) => items.filter((id) => id !== identifier));
    await loadIssues();
  }

  return {
    issues,
    loading,
    loadError,
    savingPriorities,
    loadIssues,
    moveIssue,
    changePriority,
    writeLabels: requests.write,
  };
}
