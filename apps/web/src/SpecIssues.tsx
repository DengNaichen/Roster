import { type ReactNode, useState } from "react";
import { SpecDependencies } from "./SpecDependencies";
import { NewIssueDialog } from "./Dialogs";
import { IssueFilters } from "./IssueFilters";
import { IssueViews, type ViewMode } from "./IssueViews";
import { useIssues } from "./useIssues";
import { emptyLabelFilter, useLabels, type LabelFilterValue } from "./useLabels";
import { useResource } from "./useResource";
import {
  api,
  apiPath,
  columns,
  columnsFor,
  issueScopes,
  type IssueScope,
  ModalDialog,
  RequestError,
  type IssueSort,
  type IssueSummary,
  type Priority,
  type Status,
  type Team,
} from "./shared";

export default function SpecIssues({
  id,
  team,
  tabs,
  linked,
  linksError,
  onLinksChanged,
}: {
  id: string;
  team: string;
  tabs: ReactNode;
  linked: string[];
  linksError: string;
  onLinksChanged: () => Promise<void>;
}) {
  const [dependencies, setDependencies] = useState(
    new URLSearchParams(location.search).get("view") === "dependencies",
  );
  const [savingLinks, setSavingLinks] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<IssueScope>("active");
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
  const candidates = useResource<{ issues: IssueSummary[] }>(
    linking ? apiPath("/issues?limit=-1") : null,
    {
      issues: [],
    },
  );
  const { issues, loading, loadError, loadIssues, savingPriorities, changePriority, moveIssue } =
    useIssues(
      { team: "", type, query, priority, labelFilter, assignee, specIdentifier: id },
      setError,
    );
  const statuses = issueScopes.find((item) => item.value === scope)?.statuses;
  const visible = issues
    .filter((issue) => !statuses || statuses.includes(issue.status))
    .filter((issue) => filter === "all" || issue.status === filter)
    .sort((a, b) =>
      sort === "priority"
        ? (a.priority || 5) - (b.priority || 5)
        : sort === "updated"
          ? b.updated_at.localeCompare(a.updated_at)
          : 0,
    );
  const selectedVisible = selected.filter((identifier) =>
    visible.some((issue) => issue.identifier === identifier),
  );
  const grouped = Object.fromEntries(
    columns.map((column) => [
      column.status,
      visible.filter((issue) => issue.status === column.status),
    ]),
  ) as Record<Status, IssueSummary[]>;
  async function changeLinks(identifiers: string[], linked: boolean) {
    if (savingLinks || !identifiers.length) return false;
    setSavingLinks(true);
    setError("");
    try {
      await api(apiPath(`/specs/${encodeURIComponent(id)}/issues`), linked ? "POST" : "DELETE", {
        issues: identifiers,
      });
      setSelected([]);
      await Promise.all([loadIssues(), onLinksChanged()]);
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setSavingLinks(false);
    }
  }
  return (
    <>
      <div className="project-toolbar project-tabs spec-page-tabs spec-issues-toolbar">
        {tabs}
        <div className="spec-action-row">
          <button
            className="button"
            disabled={savingLinks}
            onClick={() => {
              setError("");
              setPending([]);
              setLinkQuery("");
              setLinking(true);
            }}
          >
            Link issues
          </button>
          <button
            className="button"
            disabled={savingLinks || teams.loading || !!teams.error}
            onClick={() => setCreating(true)}
          >
            New issue
          </button>
        </div>
      </div>
      <IssueFilters
        layout="spec"
        dependencies={{
          active: dependencies,
          onSelect: () => {
            setDependencies(true);
            setSelected([]);
          },
        }}
        scope={{
          value: scope,
          onChange: (value) => {
            setScope(value);
            setFilter("all");
            setSelected([]);
          },
        }}
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
        setView={(value) => {
          setDependencies(false);
          setView(value);
        }}
        visibleCount={visible.length}
        selectVisible={() => setSelected(visible.map((i) => i.identifier))}
        selectionDisabled={loading}
      />
      {(error || loadError || linksError) && (
        <RequestError message={error || loadError || linksError} />
      )}
      {selectedVisible.length > 0 && (
        <div className="selection-toolbar" role="toolbar" aria-label="Selected issues">
          <span>{selectedVisible.length} selected</span>
          <button
            className="button"
            disabled={savingLinks}
            onClick={() => void changeLinks(selectedVisible, false)}
          >
            Unlink from spec
          </button>
          <button className="ghost" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
      )}
      {(loadError || linksError) && (
        <button
          className="button"
          onClick={() => {
            void loadIssues();
            void onLinksChanged();
          }}
        >
          Retry linked issues
        </button>
      )}
      {!dependencies && !loading && !loadError && !linksError && visible.length === 0 && (
        <p className="scope-description">
          {linked.length
            ? "No linked issues match these filters."
            : "No linked issues yet. Link existing issues or create a new one."}
        </p>
      )}
      {dependencies ? (
        <SpecDependencies id={id} visible={visible.map((issue) => issue.identifier)} />
      ) : (
        <IssueViews
          view={view}
          visibleColumns={columnsFor(view)
            .filter((c) => grouped[c.status].length > 0)
            .sort((a, b) => Number(a.status === "triage") - Number(b.status === "triage"))
            .map((c) => (c.status === "triage" ? { ...c, label: "待确认反馈" } : c))}
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
      )}
      {creating && (
        <NewIssueDialog
          teams={teams.data.teams}
          team={team}
          status="todo"
          project={null}
          projects={[]}
          onClose={() => setCreating(false)}
          onCreate={async (issue) => {
            setCreating(false);
            const linked = await changeLinks([issue.identifier], true);
            if (!linked)
              setError(
                `Created ${issue.identifier}, but linking failed. Use Link issues to retry without creating another issue.`,
              );
            setCollapsed((current) => ({ ...current, [issue.status]: false }));
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
            onSubmit={async (event) => {
              event.preventDefault();
              if (await changeLinks(pending, true)) setLinking(false);
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
            <div className="spec-link-options">
              {error && <RequestError message={error} />}
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
              <button
                className="button"
                disabled={
                  !pending.length || savingLinks || candidates.loading || !!candidates.error
                }
              >
                Link {pending.length || ""} issues
              </button>
            </footer>
          </form>
        </ModalDialog>
      )}
    </>
  );
}
