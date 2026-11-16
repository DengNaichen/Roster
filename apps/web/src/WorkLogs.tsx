import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchResource, resourceKey, useServerCache } from "./queryCache";
import { useRef, useState } from "react";
import { ChevronDown, GitBranch, MessageSquare, ScrollText } from "lucide-react";
import { personName, RequestError, WorkLog, WorkLogPage, WorkLogSummary } from "./shared";
import { MarkdownText } from "./MarkdownText";
import { useResource } from "./useResource";

const timestamp = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
type ActivityTab = "comments" | "work-logs";

export function ActivityTabs({
  value,
  onChange,
  comments,
  workLogs,
}: {
  value: ActivityTab;
  onChange: (value: ActivityTab) => void;
  comments: number;
  workLogs: number;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = [
    { id: "comments" as const, name: "Comments", count: comments, Icon: MessageSquare },
    { id: "work-logs" as const, name: "Agent work logs", count: workLogs, Icon: ScrollText },
  ];
  return (
    <div className="activity-tabs" role="tablist" aria-label="Issue activity">
      {tabs.map(({ id, name, count, Icon }, index) => (
        <button
          key={id}
          ref={(node) => {
            buttons.current[index] = node;
          }}
          type="button"
          role="tab"
          id={`tab-${id}`}
          aria-controls={`activity-${id}`}
          aria-selected={value === id}
          tabIndex={value === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = 1 - index;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = 1;
            else return;
            event.preventDefault();
            onChange(tabs[next].id);
            buttons.current[next]!.focus();
          }}
        >
          <Icon className="icon" />
          <span>{name}</span>
          <span className="activity-count">{count}</span>
        </button>
      ))}
    </div>
  );
}

export function WorkLogEntry({ entry, path }: { entry: WorkLogSummary; path: string }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`work-log work-log-${entry.kind}`}>
      <button
        className="work-log-heading"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {entry.kind === "decision" ? (
          <GitBranch className="icon" />
        ) : (
          <ScrollText className="icon" />
        )}
        <span>{entry.summary}</span>
        <ChevronDown className="icon work-log-chevron" />
      </button>
      <div className="work-log-meta">
        <span>{entry.kind === "decision" ? "Decision" : "Progress"}</span>
        <span>#{entry.id}</span>
        <time dateTime={entry.created_at}>{timestamp(entry.created_at)}</time>
        {entry.actor && <span>Recorded by {personName(entry.actor)}</span>}
      </div>
      {open && <WorkLogBody path={`${path}/work-logs/${entry.id}`} />}
    </article>
  );
}

function WorkLogBody({ path }: { path: string }) {
  const record = useResource<WorkLog | null>(path, null);
  return (
    <div className="work-log-body">
      {record.error ? (
        <>
          <RequestError message={record.error} />
          <button className="button" onClick={() => void record.reload()}>
            Retry record
          </button>
        </>
      ) : record.data ? (
        <MarkdownText text={record.data.body} />
      ) : (
        <p role="status">Loading record…</p>
      )}
    </div>
  );
}

export function WorkLogList({ path }: { path: string }) {
  const { scope, enabled } = useServerCache();
  const query = useInfiniteQuery({
    queryKey: [...resourceKey(scope.subject, `${path}/work-logs`), "pages"],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchResource<WorkLogPage>(scope, `${path}/work-logs?before=${pageParam}`, signal),
    getNextPageParam: (last) => (last.next_before > 0 ? last.next_before : undefined),
  });
  const page = {
    work_logs: query.data?.pages.flatMap((p) => p.work_logs) ?? [],
    next_before: query.data?.pages.at(-1)?.next_before ?? 0,
  };
  const loading = query.isFetching;
  const error =
    query.error?.message ??
    (query.fetchStatus === "paused" ? "Offline. Reconnect to load work logs." : "");
  const load = () =>
    query.isFetchNextPageError ? query.fetchNextPage() : query.refetch({ cancelRefetch: false });
  return (
    <div className="work-log-list">
      <p className="activity-hint">
        Agent progress, findings and verification. Newest first. Expand a record for details.
      </p>
      {page.work_logs.map((entry) => (
        <WorkLogEntry key={entry.id} entry={entry} path={path} />
      ))}
      {loading && (
        <p className="activity-hint" role="status">
          Loading work logs…
        </p>
      )}
      {error && (
        <div className="work-log-error">
          <RequestError message={error} />
          <button className="button" disabled={loading} onClick={() => void load()}>
            Retry work logs
          </button>
        </div>
      )}
      {!loading && !error && page.work_logs.length === 0 && (
        <p className="empty">No agent work logs yet.</p>
      )}
      {!error && page.next_before > 0 && (
        <button className="button" disabled={loading} onClick={() => void query.fetchNextPage()}>
          Load older records
        </button>
      )}
    </div>
  );
}
