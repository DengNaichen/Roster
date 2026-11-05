import { useCapabilities } from "./Capabilities";
import { Cycle, CyclePage, cycleName, emptyCycles } from "./Cycles";
import "./cycles.css";
import { Orbit } from "lucide-react";
import { useMemo, useState } from "react";
import { NewIssueDialog } from "./Dialogs";
import { EmojiPicker, EntityEmoji } from "./EmojiPicker";
import { IssueFilters } from "./IssueFilters";
import { IssueViews, ViewMode } from "./IssueViews";
import { emptyLabelFilter, LabelFilterValue, useLabels } from "./useLabels";
import { PageHeader } from "./PageHeader";
import { ProjectDialog, ProjectOverview } from "./ProjectManagement";
import {
  api,
  apiPath,
  columns,
  columnsFor,
  IssueScope,
  issueScopes,
  triageChanged,
  IssueSummary,
  NavLink,
  pagePath,
  RequestError,
  Status,
  Team,
  Project,
  Priority,
  IssueSort,
  WorkspaceRoute,
} from "./shared";
import { useIssues } from "./useIssues";
import { useResource } from "./useResource";

type IssueRoute = Extract<WorkspaceRoute, { kind: "issues" | "triage" | "project" | "cycle" }>;
export default function IssuesPage({
  route,
  teams,
  teamsLoading,
  onCreateTeam,
  view,
  setView,
  sort,
  setSort,
}: {
  route: IssueRoute;
  teams: Team[];
  teamsLoading: boolean;
  onCreateTeam: () => void;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  sort: IssueSort;
  setSort: (sort: IssueSort) => void;
}) {
  const capabilities = useCapabilities();
  const catalog = useLabels();
  const [labelFilter, setLabelFilter] = useState<LabelFilterValue>(emptyLabelFilter);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const triage = route.kind === "triage";
  const [chosenFilter, setFilter] = useState<Status | "all">("all");
  const [chosenScope, setScope] = useState<IssueScope>("active");
  // The Triage inbox is a fixed view of the triage status.
  const filter: Status | "all" = triage ? "triage" : chosenFilter;
  const [teamFilter, setTeamFilter] = useState("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [type, setType] = useState("");
  const [assignee, setAssignee] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Partial<Record<Status, boolean>>>({});
  const [projectDialog, setProjectDialog] = useState(false);
  const [projectTab, setProjectTab] = useState<"overview" | "issues">("overview");
  const [savedIssue, setSavedIssue] = useState<IssueSummary | null>(null);
  const cycle = useResource<Cycle | null>(
    route.kind === "cycle" ? apiPath(`/cycles/${route.id}`) : null,
    null,
  );
  const cycleTeam = useResource<CyclePage>(
    route.kind === "cycle" ? apiPath(`/teams/${encodeURIComponent(route.team)}/cycles`) : null,
    emptyCycles,
  );
  const [creating, setCreating] = useState(false);
  const scopeTeam =
    route.kind === "issues" || route.kind === "triage" || route.kind === "cycle" ? route.team : "";
  const team = scopeTeam || teamFilter;
  const project = useResource<Project | null>(
    route.kind === "project" ? apiPath(`/projects/by-id/${route.id}`) : null,
    null,
  );
  const projects = useResource<{ projects: Project[] }>(
    capabilities.projects ? apiPath("/projects") : null,
    { projects: [] },
  );
  const activeProject = project.data;
  const {
    issues,
    loading: issuesLoading,
    loadError,
    savingPriorities,
    loadIssues,
    moveIssue: moveIssueRequest,
    changePriority,
  } = useIssues(
    {
      cycleID: route.kind === "cycle" ? route.id : undefined,
      projectID: route.kind === "project" ? route.id : undefined,
      team,
      type,
      query,
      priority,
      labelFilter,
      assignee,
    },
    setError,
  );
  const loading = issuesLoading || project.loading || cycle.loading || teamsLoading;
  const grouped = useMemo(
    () =>
      Object.fromEntries(
        columns.map(({ status }) => [
          status,
          issues
            .filter((issue) => issue.status === status)
            .sort((a, b) => {
              if (sort === "priority" || (sort === "auto" && status === "agent_ready")) {
                const difference =
                  (a.priority === 0 ? 5 : a.priority) - (b.priority === 0 ? 5 : b.priority);
                if (difference) return difference;
              }
              return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
            }),
        ]),
      ) as Record<Status, IssueSummary[]>,
    [issues, sort],
  );

  // Only the team and workspace lists have Active / Backlog / All issues views.
  const scoped = route.kind === "issues";
  const scope = scoped ? chosenScope : "all";
  const scopeStatuses = issueScopes.find((item) => item.value === scope)?.statuses;
  // Triage lives in its own inbox, so the other lists leave it out unless asked for.
  const visibleColumns = columnsFor(view).filter((column) =>
    filter === "all"
      ? column.status !== "triage" && (!scopeStatuses || scopeStatuses.includes(column.status))
      : column.status === filter,
  );
  const visibleStatuses = new Set<Status>(visibleColumns.map((column) => column.status));
  // Listing every status without a search starts with Done and Canceled collapsed; a header click overrides the default until filters change.
  const defaultCollapsed = (status: Status) =>
    filter === "all" && !query && (status === "done" || status === "canceled");
  const isCollapsed = (status: Status) => collapsed[status] ?? defaultCollapsed(status);
  const activeTeam = teams.find((item) => item.key === scopeTeam);
  const showOverview = route.kind === "project" && projectTab === "overview";
  const heading =
    (cycle.data ? cycleName(cycle.data) : "") ||
    activeProject?.name ||
    (scopeTeam
      ? `${activeTeam?.name ?? scopeTeam} / ${triage ? "Triage" : "Issues"}`
      : "All issues");
  const scopeError =
    cycle.error ||
    (cycle.data && route.kind === "cycle" && cycle.data.team !== route.team
      ? "Cycle not found."
      : "") ||
    project.error ||
    loadError ||
    (!teamsLoading && scopeTeam && !activeTeam ? "Team not found." : "");
  const canCreate =
    (route.kind !== "cycle" ||
      (cycle.data?.state !== "completed" &&
        cycleTeam.data.settings.enabled &&
        !cycleTeam.error &&
        !cycleTeam.loading)) &&
    !loading &&
    !scopeError &&
    !projects.loading &&
    !projects.error &&
    !activeProject?.archived &&
    (activeProject === null || activeProject.teams.length > 0);
  const visibleIdentifiers = new Set(
    issues.filter((issue) => visibleStatuses.has(issue.status)).map((issue) => issue.identifier),
  );
  const selectedVisible = selected.filter((id) => visibleIdentifiers.has(id));
  function toggleIssue(id: string) {
    setSelected((ids) => (ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]));
  }
  const visibleCount = visibleColumns.reduce(
    (count, column) => count + grouped[column.status].length,
    0,
  );

  // A status filter and an issue view are two ways to narrow by status: the last choice wins.
  function changeStatusFilter(status: Status | "all") {
    setFilter(status);
    if (status !== "all") setScope("all");
    setCollapsed({});
    setSelected([]);
  }

  function changeScope(next: IssueScope) {
    setScope(next);
    setFilter("all");
    setCollapsed({});
    setSelected([]);
  }

  function changeTeamFilter(value: string) {
    setTeamFilter(value);
    setCollapsed({});
    setSelected([]);
  }

  function submitQuery(value: string) {
    setQuery(value);
    setCollapsed({});
  }

  async function moveIssue(identifier: string, status: Status) {
    await moveIssueRequest(identifier, status);
    window.dispatchEvent(new Event(triageChanged));
    await cycle.reload();
  }
  async function addIssue(issue: IssueSummary) {
    setSavedIssue(issue);
    window.dispatchEvent(new Event(triageChanged));
    await loadIssues();
    await cycle.reload();
    setCollapsed((current) => ({ ...current, [issue.status]: false }));
    setCreating(false);
  }
  async function saveProject() {
    await Promise.all([project.reload(), projects.reload(), loadIssues()]);
    setProjectDialog(false);
  }
  return (
    <>
      <PageHeader
        actions={
          !scopeError && (
            <button className="button" disabled={!canCreate} onClick={() => setCreating(true)}>
              New issue
            </button>
          )
        }
      >
        {route.kind === "project" && (
          <>
            <NavLink to={pagePath("/projects")}>Projects</NavLink>
            <span className="separator">›</span>
          </>
        )}
        {route.kind === "cycle" ? (
          <>
            {activeTeam && <EntityEmoji emoji={activeTeam.emoji} teamKey={activeTeam.key} />}
            <NavLink to={pagePath(`/team/${encodeURIComponent(route.team)}/issues`)}>
              {activeTeam?.name ?? route.team}
            </NavLink>
            <span className="separator">›</span>
            <NavLink to={pagePath(`/team/${encodeURIComponent(route.team)}/cycles`)}>
              Cycles
            </NavLink>
            <span className="separator">›</span>
            <Orbit className="icon cycle-crumb-icon" aria-hidden="true" />
          </>
        ) : (
          <>
            {activeProject ? (
              <EmojiPicker
                value={activeProject.emoji}
                label={`Change emoji for project ${activeProject.name}`}
                onChange={async (emoji) => {
                  const updated = await api<Project>(
                    apiPath(`/projects/by-id/${activeProject.id}`),
                    "PATCH",
                    { emoji },
                  );
                  project.update(() => updated);
                }}
              />
            ) : activeTeam ? (
              <EntityEmoji emoji={activeTeam.emoji} teamKey={activeTeam.key} />
            ) : null}
          </>
        )}
        <span>{heading}</span>
      </PageHeader>
      {activeProject && !scopeError && (
        <div className="project-toolbar project-tabs">
          <div className="segmented" role="tablist" aria-label="Project sections">
            <button
              type="button"
              role="tab"
              aria-selected={projectTab === "overview"}
              aria-pressed={projectTab === "overview"}
              onClick={() => setProjectTab("overview")}
            >
              Overview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={projectTab === "issues"}
              aria-pressed={projectTab === "issues"}
              onClick={() => setProjectTab("issues")}
            >
              Issues
            </button>
          </div>
        </div>
      )}
      {!scopeError && !showOverview && (
        <IssueFilters
          assignee={assignee}
          setAssignee={setAssignee}
          membershipEnabled={teams.some((item) => item.membership_enabled)}
          filter={filter}
          setFilter={changeStatusFilter}
          statusLocked={triage}
          scope={scoped ? { value: scope, onChange: changeScope } : undefined}
          team={teamFilter}
          teams={
            route.kind === "project" && activeProject
              ? teams.filter((item) => activeProject.teams.includes(item.key))
              : []
          }
          setTeam={changeTeamFilter}
          type={type}
          setType={setType}
          query={query}
          submitQuery={submitQuery}
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
          visibleCount={visibleCount}
          selectionDisabled={loading}
          selectVisible={() =>
            setSelected(
              issues
                .filter((issue) => visibleStatuses.has(issue.status))
                .map((issue) => issue.identifier),
            )
          }
        />
      )}

      {showOverview && activeProject && (
        <ProjectOverview
          project={activeProject}
          teams={teams}
          onEdit={() => setProjectDialog(true)}
          onSaved={saveProject}
        />
      )}
      {cycleTeam.error && (
        <div className="scope-message">
          <RequestError message={cycleTeam.error} />
          <button className="button" onClick={() => void cycleTeam.reload()}>
            Retry cycle settings
          </button>
        </div>
      )}
      {projects.error && (
        <div className="scope-message">
          <RequestError message={projects.error} />
          <button className="button" onClick={() => void projects.reload()}>
            Retry projects
          </button>
        </div>
      )}
      {scopeError && (
        <div className="scope-message">
          <RequestError message={scopeError} />
          <button
            className="button"
            onClick={() => {
              void loadIssues();
              void project.reload();
              void cycle.reload();
            }}
          >
            Retry
          </button>{" "}
          <NavLink to={pagePath("/")}>Back to all issues</NavLink>
        </div>
      )}
      {savedIssue && (
        <p className="scope-description" role="status">
          Created {savedIssue.identifier}.{" "}
          <NavLink to={pagePath(`/issue/${savedIssue.identifier}`)}>View issue</NavLink>
        </p>
      )}
      {error && <RequestError message={error} />}
      {!scopeError &&
        !showOverview &&
        (!loading && teams.length === 0 ? (
          <div className="scope-message">
            <p>No teams yet. Create a team to start adding issues.</p>
            <button className="button" onClick={onCreateTeam}>
              Create team
            </button>
          </div>
        ) : (
          <IssueViews
            view={view}
            visibleColumns={visibleColumns}
            grouped={grouped}
            loading={loading}
            isCollapsed={isCollapsed}
            toggleGroup={(status) =>
              setCollapsed((current) => ({
                ...current,
                [status]: !(current[status] ?? defaultCollapsed(status)),
              }))
            }
            actions={{
              selected: selectedVisible,
              toggle: toggleIssue,
              savingPriorities,
              changePriority,
              moveIssue,
            }}
          />
        ))}
      {projectDialog && activeProject && (
        <ProjectDialog
          project={activeProject}
          teams={teams}
          onClose={() => setProjectDialog(false)}
          onSaved={saveProject}
        />
      )}
      {creating && (
        <NewIssueDialog
          cycleID={route.kind === "cycle" ? route.id : undefined}
          teams={teams}
          team={scopeTeam}
          projects={projects.data.projects}
          status={filter === "all" ? "triage" : filter}
          project={activeProject}
          onClose={() => setCreating(false)}
          onCreate={addIssue}
        />
      )}
    </>
  );
}
