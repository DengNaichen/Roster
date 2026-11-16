import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import type { Issue, IssueDetails, IssueSummary, Status } from "./shared";

export type IssueList = { issues: IssueSummary[]; next_cursor?: string | null };
export const collectionPath = (path: string) =>
  /\/issues(?:\?|$)/.test(path) && !/\/issues\/[^/?]+/.test(path);
export const inWorkspace = (query: Query, subject: string, workspace: string | null) =>
  query.queryKey[0] === "resource" &&
  query.queryKey[1] === subject &&
  query.queryKey[2] === workspace;
const workspaceOf = (path: string) => /^\/api\/w\/([^/?]+)/.exec(path)?.[1] ?? null;
const pathOf = (query: Query) => String(query.queryKey[3] ?? "");

export function cachedIssue(
  client: QueryClient,
  subject: string,
  path: string,
  identifier: string,
) {
  const candidates = client
    .getQueryCache()
    .getAll()
    .filter((q) => inWorkspace(q, subject, workspaceOf(path)))
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const query of candidates) {
    if (new URL(pathOf(query), "http://roster.local").pathname.endsWith(`/issues/${identifier}`)) {
      const record = client.getQueryData<IssueDetails>(query.queryKey);
      if (record) return { record, key: query.queryKey };
    }
  }
  for (const query of candidates) {
    if (!collectionPath(pathOf(query))) continue;
    const record = client
      .getQueryData<IssueList>(query.queryKey)
      ?.issues.find((issue) => issue.identifier === identifier);
    if (record) return { record, key: query.queryKey };
  }
  return undefined;
}

// Dependencies of a write, including count queries. Never invalidate unrelated catalogs for issue properties.
export function writeFilter(
  subject: string,
  writePath: string,
  client: QueryClient,
  properties = false,
) {
  const write = writePath.split("?")[0];
  const base = write.replace(/(\/api\/w\/[^/]+).*/, "$1");
  const resource = write.slice(base.length).split("/")[1] ?? "";
  const identifier = /\/issues\/([^/]+)/.exec(write)?.[1];
  const source = identifier
    ? cachedIssue(client, subject, writePath, identifier)?.record
    : undefined;
  return (query: Query) => {
    if (!inWorkspace(query, subject, workspaceOf(writePath))) return false;
    const read = pathOf(query).split("?")[0];
    const issueRead = read.includes("/issues");
    if (resource === "issues" && identifier) {
      if (
        collectionPath(pathOf(query)) ||
        read === `${base}/issues/${identifier}` ||
        read.startsWith(`${base}/issues/${identifier}/`)
      )
        return true;
      if (!properties && (read.includes("/cycles") || read.includes("/specs"))) return true;
      if (
        source?.cycle_id &&
        (read === `${base}/cycles/${source.cycle_id}` ||
          read === `${base}/teams/${identifier.slice(0, identifier.lastIndexOf("-"))}/cycles`)
      )
        return true;
      if (/\/issues\/[^/]+$/.test(read)) {
        const data = client.getQueryData<IssueDetails>(query.queryKey);
        return [data?.children, data?.blocks, data?.blocked_by, data?.related].some((items) =>
          items?.some((item) => item.identifier === identifier),
        );
      }
      return false;
    }
    if (["", "teams", "members", "access"].includes(resource)) return true;
    if (["issues", "issue-labels"].includes(resource))
      return issueRead || read.includes("/cycles") || read.includes("/specs");
    if (["labels", "label-groups"].includes(resource))
      return issueRead || /\/(labels|label-groups)(?:\/|$)/.test(read);
    if (resource === "projects") return issueRead || /\/(projects|initiatives)(?:\/|$)/.test(read);
    if (resource === "cycles") return issueRead || read.includes("/cycles");
    if (resource === "specs") return issueRead || read.includes("/specs");
    return read === write || read.startsWith(`${base}/${resource}`);
  };
}

export type ListPosition = { key: QueryKey; index: number };
export function issuePositions(
  client: QueryClient,
  subject: string,
  path: string,
  identifier: string,
) {
  return client
    .getQueriesData<IssueList>({
      predicate: (q) => inWorkspace(q, subject, workspaceOf(path)) && collectionPath(pathOf(q)),
    })
    .flatMap(([key, data]) => {
      const index = data?.issues.findIndex((issue) => issue.identifier === identifier) ?? -1;
      return index < 0 ? [] : [{ key, index }];
    });
}
const sameKey = (a: QueryKey, b: QueryKey) => JSON.stringify(a) === JSON.stringify(b);
function fitsSimpleFilters(url: URL, issue: IssueSummary, subject: string): boolean | undefined {
  const p = url.searchParams;
  if (p.has("status") && p.get("status") !== issue.status) return false;
  if (p.has("priority") && Number(p.get("priority")) !== issue.priority) return false;
  if (
    p.get("team") &&
    p.get("team") !== issue.identifier.slice(0, issue.identifier.lastIndexOf("-"))
  )
    return false;
  if (p.has("type") && p.get("type") !== (issue.type ?? "")) return false;
  if (p.has("cycle_id") && Number(p.get("cycle_id")) !== (issue.cycle_id ?? 0)) return false;
  if (p.has("project_id") && Number(p.get("project_id")) !== (issue.project_id ?? 0)) return false;
  if (p.has("assignee") && p.get("assignee") !== (issue.assignee?.subject ?? "")) return false;
  if (p.get("assigned_to_me") === "true" && issue.assignee?.subject !== subject) return false;
  if (
    (p.get("label_mode") && p.get("label_mode") !== "any") ||
    p.get("query") ||
    p.has("label_id") ||
    p.has("label_group_id") ||
    p.has("cursor") ||
    p.has("project") ||
    p.has("parent") ||
    p.has("spec") ||
    url.pathname.includes("/specs/")
  )
    return undefined;
  return true;
}
function summary(issue: IssueSummary): IssueSummary {
  const {
    identifier,
    title,
    status,
    priority,
    type,
    project,
    project_id,
    project_emoji,
    cycle_id,
    parent,
    labels,
    assignee,
    created_at,
    updated_at,
  } = issue;
  return {
    identifier,
    title,
    status,
    priority,
    type,
    project,
    project_id,
    project_emoji,
    cycle_id,
    parent,
    labels,
    assignee,
    created_at,
    updated_at,
  };
}

// Reconcile only rows whose membership/order is known. Incomplete or complex collections are revalidated.
export function mergeIssueCaches(
  client: QueryClient,
  subject: string,
  path: string,
  record: IssueSummary | Issue,
  positions: ListPosition[],
  previousStatus: Status,
) {
  const value = summary(record);
  const affected = writeFilter(subject, path, client, true);
  for (const query of client.getQueryCache().getAll()) {
    if (!affected(query)) continue;
    const updatedAt = query.state.dataUpdatedAt;
    const invalidated = query.state.isInvalidated;
    function update<T>(change: (current: T | undefined) => T | undefined) {
      client.setQueryData<T>(query.queryKey, change, { updatedAt });
      if (invalidated) query.invalidate();
    }
    const queryPath = pathOf(query);
    if (collectionPath(queryPath)) {
      const data = client.getQueryData<IssueList>(query.queryKey);
      if (!data) continue;
      const url = new URL(queryPath, "http://roster.local");
      const index = data.issues.findIndex((issue) => issue.identifier === record.identifier);
      const original = positions.find((position) => sameKey(position.key, query.queryKey));
      const fits = fitsSimpleFilters(url, value, subject);
      let items = data.issues;
      let verify = false;
      if (index >= 0) {
        items =
          fits === false
            ? items.filter((issue) => issue.identifier !== record.identifier)
            : items.map((issue) =>
                issue.identifier === record.identifier
                  ? summary({
                      ...issue,
                      status: value.status,
                      priority: value.priority,
                      updated_at: value.updated_at,
                    })
                  : issue,
              );
        verify =
          Boolean(data.next_cursor) &&
          (fits === false || ["updated", "priority"].includes(url.searchParams.get("sort") ?? ""));
      } else if (
        fits !== false &&
        (original || (fits === true && url.searchParams.get("limit") === "-1"))
      ) {
        items = [...items];
        items.splice(original?.index ?? 0, 0, value);
      } else if (fits !== false) verify = true;
      if (items !== data.issues) {
        const sort =
          url.searchParams.get("sort") ||
          (url.searchParams.get("status") === "agent_ready" ? "priority" : "updated");
        const timestamp = sort === "created" ? "created_at" : "updated_at";
        items = [...items].sort(
          (a, b) =>
            (sort === "priority" ? (a.priority || 5) - (b.priority || 5) : 0) ||
            b[timestamp].localeCompare(a[timestamp]),
        );
        // A page boundary or timestamp tie requires the server's UUID tie-breaker.
        if (
          data.next_cursor ||
          items.some(
            (item) => item.identifier !== value.identifier && item[timestamp] === value[timestamp],
          )
        )
          verify = true;
        update<IssueList>(() => ({ ...data, issues: items }));
      }
      if (verify)
        void client.invalidateQueries({
          queryKey: query.queryKey,
          exact: true,
          refetchType: "none",
        });
    } else if (/\/issues\/[^/?]+$/.test(queryPath)) {
      update<IssueDetails>((current) => {
        if (!current) return undefined;
        if (current.identifier === record.identifier)
          return {
            ...current,
            status: record.status,
            priority: record.priority,
            updated_at: record.updated_at,
          };
        const fields = ["children", "blocks", "blocked_by", "related"] as const;
        if (
          !fields.some((field) =>
            current[field]?.some((item) => item.identifier === record.identifier),
          )
        )
          return current;
        return {
          ...current,
          ...Object.fromEntries(
            fields.map((field) => [
              field,
              current[field]?.map((item) => (item.identifier === record.identifier ? value : item)),
            ]),
          ),
        };
      });
    } else if (record.cycle_id && queryPath.includes("/cycles")) {
      // Status-only writes preserve cycle membership. Adjust counts from the previous visible state.
      const deltaDone = Number(record.status === "done") - Number(previousStatus === "done");
      const deltaCanceled =
        Number(record.status === "canceled") - Number(previousStatus === "canceled");
      type Counts = { id: number; done: number; canceled: number };
      const adjust = (cycle: Counts) =>
        cycle.id === record.cycle_id
          ? { ...cycle, done: cycle.done + deltaDone, canceled: cycle.canceled + deltaCanceled }
          : cycle;
      if (/\/cycles\/\d+$/.test(queryPath))
        update<Counts>((current) => (current ? adjust(current) : undefined));
      else
        update<{ cycles: Counts[] }>((current) =>
          current ? { ...current, cycles: current.cycles.map(adjust) } : undefined,
        );
    }
  }
}
