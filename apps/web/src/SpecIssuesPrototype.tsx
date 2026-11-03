import { useState } from "react";
import { NewIssueDialog } from "./Dialogs";
import { IssueFilters } from "./IssueFilters";
import { IssueViews, type ViewMode } from "./IssueViews";
import { useIssues } from "./useIssues";
import { emptyLabelFilter, useLabels, type LabelFilterValue } from "./useLabels";
import { useResource } from "./useResource";
import {
  apiPath,
  columns,
  ModalDialog,
  RequestError,
  type IssueSort,
  type IssueSummary,
  type Priority,
  type Status,
  type Team,
} from "./shared";

// Preview-only associations; issue contents and editing use the existing API.
export function prototypeLinks(id: string): string[] {
  try {
    const saved = localStorage.getItem(`roster-prototype-links:${id}`);
    if (saved) return JSON.parse(saved);
    // The isolated preview database contains these 50 seeded demo issues.
    return import.meta.env.DEV && import.meta.env.VITE_LOCAL_PREVIEW === "true" && id === "SPEC-1"
      ? Array.from({ length: 50 }, (_, index) => `RO-${index + 7}`)
      : [];
  } catch {
    return [];
  }
}

export default function SpecIssuesPrototype({
  id,
  team,
  title,
  onCount,
}: {
  id: string;
  team: string;
  title: string;
  onCount: (count: number) => void;
}) {
  const [linked, setLinked] = useState(() => prototypeLinks(id));
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [priority, setPriority] = useState<Priority | "">("");
  const [type, setType] = useState("");
  const [assignee, setAssignee] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<IssueSort>("auto");
  const [view, setView] = useState<ViewMode>("list");
  const [labelFilter, setLabelFilter] = useState<LabelFilterValue>(emptyLabelFilter);
  const [collapsed, setCollapsed] = useState<Partial<Record<Status, boolean>>>({
    done: true,
    canceled: true,
  });
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const catalog = useLabels();
  const teams = useResource<{ teams: Team[] }>(apiPath("/teams"), { teams: [] });
  const candidates = useResource<{ issues: IssueSummary[] }>(linking ? apiPath("/issues") : null, {
    issues: [],
  });
  const { issues, loading, loadError, loadIssues, savingPriorities, changePriority, moveIssue } =
    useIssues({ team: "", type, query, priority, labelFilter, assignee }, setError);
  const visible = issues
    .filter(
      (issue) => linked.includes(issue.identifier) && (filter === "all" || issue.status === filter),
    )
    .sort((a, b) =>
      sort === "priority"
        ? (a.priority || 5) - (b.priority || 5)
        : sort === "updated"
          ? b.updated_at.localeCompare(a.updated_at)
          : 0,
    );
  const grouped = Object.fromEntries(
    columns.map((column) => [
      column.status,
      visible.filter((issue) => issue.status === column.status),
    ]),
  ) as Record<Status, IssueSummary[]>;
  function saveLinks(next: string[]) {
    localStorage.setItem(`roster-prototype-links:${id}`, JSON.stringify(next));
    setLinked(next);
    onCount(next.length);
    setSelected([]);
  }
  return (
    <>
      <div className="project-toolbar">
        <span className="view-count">{title}</span>
        <div className="spec-action-row">
          <button
            className="button"
            onClick={() => {
              setPending([]);
              setLinkQuery("");
              setLinking(true);
            }}
          >
            Link issues
          </button>
          <button className="button" onClick={() => setCreating(true)}>
            New issue
          </button>
        </div>
      </div>
      <IssueFilters
        assignee={assignee}
        setAssignee={setAssignee}
        membershipEnabled={teams.data.teams.some((t) => t.membership_enabled)}
        filter={filter}
        setFilter={setFilter}
        team=""
        teams={[]}
        setTeam={() => {}}
        type={type}
        setType={setType}
        query={query}
        submitQuery={setQuery}
        priority={priority}
        setPriority={setPriority}
        sort={sort}
        setSort={setSort}
        labelFilter={labelFilter}
        setLabelFilter={setLabelFilter}
        catalog={catalog}
        clearSelection={() => setSelected([])}
        view={view}
        setView={setView}
        visibleCount={visible.length}
        selectVisible={() => setSelected(visible.map((i) => i.identifier))}
        selectionDisabled={loading}
      />
      {(error || loadError) && <RequestError message={error || loadError} />}
      {selected.length > 0 && (
        <div className="selection-toolbar" role="toolbar" aria-label="Selected issues">
          <span>{selected.length} selected</span>
          <button
            className="button"
            onClick={() => saveLinks(linked.filter((identifier) => !selected.includes(identifier)))}
          >
            Unlink from spec
          </button>
          <button className="ghost" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
      )}
      {!loading && visible.length === 0 && (
        <p className="scope-description">
          {linked.length
            ? "No linked issues match these filters."
            : "No linked issues yet. Link existing issues or create a new one."}
        </p>
      )}
      <IssueViews
        view={view}
        visibleColumns={columns.filter((c) => grouped[c.status].length > 0)}
        grouped={grouped}
        loading={loading}
        isCollapsed={(status) => !!collapsed[status]}
        toggleGroup={(status) =>
          setCollapsed((current) => ({ ...current, [status]: !current[status] }))
        }
        actions={{
          selected,
          toggle: (identifier) =>
            setSelected((current) =>
              current.includes(identifier)
                ? current.filter((i) => i !== identifier)
                : [...current, identifier],
            ),
          savingPriorities,
          changePriority,
          moveIssue,
        }}
      />
      {creating && (
        <NewIssueDialog
          teams={teams.data.teams}
          team={team}
          status="todo"
          project={null}
          projects={[]}
          onClose={() => setCreating(false)}
          onCreate={async (issue) => {
            saveLinks([...linked, issue.identifier]);
            setCollapsed((current) => ({ ...current, [issue.status]: false }));
            await loadIssues();
            setCreating(false);
          }}
        />
      )}
      {linking && (
        <ModalDialog
          className="issue-dialog"
          onClose={() => setLinking(false)}
          aria-label="Link issues"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveLinks([...new Set([...linked, ...pending])]);
              setLinking(false);
              void loadIssues();
            }}
          >
            <header>
              <h2>Link issues to {id}</h2>
              <button type="button" className="ghost" onClick={() => setLinking(false)}>
                Close
              </button>
            </header>
            <label>
              Search issues
              <input
                autoFocus
                value={linkQuery}
                onChange={(event) => setLinkQuery(event.target.value)}
                placeholder="Search by title or identifier"
              />
            </label>
            <div className="prototype-link-options">
              {candidates.error && <RequestError message={candidates.error} />}{" "}
              {candidates.loading && <p>Loading…</p>}
              {candidates.data.issues
                .filter(
                  (issue) =>
                    !linked.includes(issue.identifier) &&
                    `${issue.identifier} ${issue.title}`
                      .toLowerCase()
                      .includes(linkQuery.toLowerCase()),
                )
                .map((issue) => (
                  <label className="label-option" key={issue.identifier}>
                    <input
                      type="checkbox"
                      checked={pending.includes(issue.identifier)}
                      onChange={() =>
                        setPending((current) =>
                          current.includes(issue.identifier)
                            ? current.filter((i) => i !== issue.identifier)
                            : [...current, issue.identifier],
                        )
                      }
                    />
                    <span className="identifier">{issue.identifier}</span>
                    <span>{issue.title}</span>
                  </label>
                ))}
            </div>
            <footer>
              <button type="button" className="ghost" onClick={() => setLinking(false)}>
                Cancel
              </button>
              <button className="button" disabled={!pending.length}>
                Link {pending.length || ""} issues
              </button>
            </footer>
          </form>
        </ModalDialog>
      )}
    </>
  );
}
