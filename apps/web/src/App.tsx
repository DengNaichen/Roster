import { CapabilitiesProvider, FeatureUnavailable, useCapabilities } from "./Capabilities";
import { Component, lazy, ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { CreateTeamDialog } from "./Dialogs";
import type { ViewMode } from "./IssueViews";
import { Sidebar } from "./Sidebar";
import { RosterLogo } from "./RosterLogo";
import { JoinWorkspace } from "./WorkspaceAccess";
import { WorkspaceDialog } from "./WorkspaceMenu";
import { Session } from "./Session";
import {
  api,
  apiPath,
  IssueSort,
  navigate,
  NavLink,
  pagePath,
  RequestError,
  Team,
  Workspace,
  workspaceRoute,
  workspaceSlug,
} from "./shared";
import { useResource } from "./useResource";

const SpecsPage = lazy(() => import("./SpecsPage"));
const SpecPage = lazy(() => import("./SpecPage"));
const CyclesPage = lazy(() => import("./CyclesPage"));
const IssuesPage = lazy(() => import("./IssuesPage"));
const ProjectsPage = lazy(() => import("./ProjectsPage"));
const InitiativesPage = lazy(() => import("./InitiativesPage"));
const IssuePage = lazy(() => import("./IssuePage"));
const LabelsPage = lazy(() => import("./LabelsPage"));
const SettingsPage = lazy(() => import("./SettingsPage"));

// The first path segment names the workspace; the root opens the first one.
function App() {
  const [slug, setSlug] = useState(workspaceSlug());

  useEffect(() => {
    const sync = () => setSlug(workspaceSlug());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return slug === "auth" && window.location.pathname === "/auth/join" ? (
    <JoinWorkspace />
  ) : slug ? (
    <WorkspaceView key={slug} />
  ) : (
    <FirstWorkspace />
  );
}

// The root names no workspace: it replaces itself with the first workspace by
// slug, or explains how to create one when there is none.
function FirstWorkspace() {
  const [empty, setEmpty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    api<{ workspaces: Workspace[] }>("/api/workspaces").then(
      ({ workspaces }) => {
        if (!active) return;
        if (workspaces.length === 0) {
          setEmpty(true);
          return;
        }
        window.history.replaceState(null, "", `/${workspaces[0].slug}/`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
      (cause: Error) => {
        if (active) setError(cause.message);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <main className="panel first-workspace">
      <div className="first-workspace-body">
        <RosterLogo className="first-workspace-mark" />
        {error ? (
          <>
            <h1>Could not load workspaces</h1>
            <RequestError message={error} />
            <div className="onboarding-actions">
              <button className="button primary" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </button>
            </div>
          </>
        ) : empty ? (
          <>
            <h1>Welcome to Roster</h1>
            <p>
              You haven’t joined a workspace yet. Create one for your organization or personal work,
              or open an invitation link from an administrator.
            </p>
            <ul className="onboarding-steps" aria-label="How Roster is organized">
              <li>
                <strong>Workspace</strong> — shared container for members, projects, and your MCP
                endpoint.
              </li>
              <li>
                <strong>Team</strong> — issue queue (<code>KEY-1</code>, <code>KEY-2</code>), specs,
                and cycles for a product or repository.
              </li>
              <li>
                <strong>Coding agent</strong> — connect Codex, Claude Code, or Cursor via MCP from
                any repository once a team is ready.
              </li>
            </ul>
            <div className="onboarding-actions">
              <button className="button primary" onClick={() => setCreating(true)}>
                Create workspace
              </button>
            </div>
          </>
        ) : (
          <p className="empty">Loading…</p>
        )}
      </div>
      {creating && (
        <WorkspaceDialog
          onClose={() => setCreating(false)}
          onSaved={(workspace) => navigate(`/${workspace.slug}/`)}
        />
      )}
      <Session />
    </main>
  );
}

// The shell lives for the workspace; only the destination resets on navigation.
function WorkspaceView() {
  return (
    <CapabilitiesProvider slug={workspaceSlug()}>
      <WorkspaceContent />
    </CapabilitiesProvider>
  );
}

function WorkspaceContent() {
  const capabilities = useCapabilities();
  const [location, setLocation] = useState({ path: window.location.pathname, visit: 0 });
  const [returnTo, setReturnTo] = useState(pagePath("/"));
  const [view, setView] = useState<ViewMode>("list");
  const [sort, setSort] = useState<IssueSort>("auto");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const teams = useResource<{ teams: Team[] }>(apiPath("/teams"), { teams: [] });
  const route = useMemo(() => workspaceRoute(location.path), [location.path]);
  useEffect(() => {
    if (route.kind !== "settings" && route.kind !== "labels" && route.kind !== "invalid") {
      setReturnTo(location.path + window.location.search + window.location.hash);
    }
  }, [location.path, route.kind]);
  useEffect(() => {
    const sync = () => {
      setLocation((previous) => ({ path: window.location.pathname, visit: previous.visit + 1 }));
      setCreatingTeam(false);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const unavailable =
    (route.kind === "projects" || route.kind === "project") && !capabilities.projects
      ? "Projects"
      : (route.kind === "initiatives" || route.kind === "initiative") && !capabilities.initiatives
        ? "Initiatives"
        : route.kind === "labels" && !capabilities.labels
          ? "Labels"
          : (route.kind === "cycles" || route.kind === "cycle") && !capabilities.cycles
            ? "Cycles"
            : "";
  const scopeTeam = "team" in route ? route.team : "";
  const invalidTeam =
    scopeTeam &&
    !teams.loading &&
    !teams.error &&
    !teams.data.teams.some((team) => team.key === scopeTeam);
  return (
    <div
      className={`app-shell ${route.kind === "settings" || route.kind === "labels" ? "settings-shell" : ""}`}
    >
      <Sidebar
        route={route}
        returnTo={returnTo}
        visit={location.visit}
        teams={teams.data.teams}
        onCreateTeam={() => setCreatingTeam(true)}
      />
      <main className="panel">
        {teams.error && (
          <div className="scope-message">
            <RequestError message={teams.error} />
            <button className="button" onClick={() => void teams.reload()}>
              Retry teams
            </button>
          </div>
        )}
        <PageBoundary key={location.visit}>
          <Suspense fallback={<p className="empty">Loading…</p>}>
            {unavailable ? (
              <FeatureUnavailable name={unavailable} />
            ) : invalidTeam || route.kind === "invalid" ? (
              <div className="scope-message">
                <RequestError
                  message={invalidTeam ? "Team not found." : "This page does not exist."}
                />
                <NavLink to={pagePath("/")}>Back to all issues</NavLink>
              </div>
            ) : route.kind === "issues" ||
              route.kind === "triage" ||
              route.kind === "project" ||
              route.kind === "cycle" ? (
              <IssuesPage
                route={route}
                teams={teams.data.teams}
                teamsLoading={teams.loading}
                onCreateTeam={() => setCreatingTeam(true)}
                view={view}
                setView={setView}
                sort={sort}
                setSort={setSort}
              />
            ) : route.kind === "cycles" ? (
              <CyclesPage team={route.team} teams={teams.data.teams} />
            ) : route.kind === "projects" ? (
              <ProjectsPage
                team={route.team}
                teams={teams.data.teams}
                teamsLoading={teams.loading}
                onCreateTeam={() => setCreatingTeam(true)}
              />
            ) : route.kind === "initiatives" || route.kind === "initiative" ? (
              <InitiativesPage
                id={route.kind === "initiative" ? route.id : undefined}
                teams={teams.data.teams}
              />
            ) : route.kind === "issue" ? (
              <IssuePage identifier={route.identifier} teams={teams.data.teams} />
            ) : route.kind === "specs" ? (
              <SpecsPage team={route.team} teams={teams.data.teams} />
            ) : route.kind === "spec" ? (
              <SpecPage id={route.identifier} />
            ) : route.kind === "labels" ? (
              <LabelsPage />
            ) : (
              <SettingsPage
                settingsTeam={route.kind === "settings" ? route.settingsTeam : undefined}
                section={route.kind === "settings" ? (route.section ?? "teams") : "teams"}
                onCreateTeam={() => setCreatingTeam(true)}
                teams={teams.data.teams}
                loading={teams.loading}
                onSaved={(updated) =>
                  teams.update((data) => ({
                    teams: data.teams.map((team) => (team.key === updated.key ? updated : team)),
                  }))
                }
              />
            )}
          </Suspense>
        </PageBoundary>
      </main>
      {creatingTeam && (
        <CreateTeamDialog
          onClose={() => setCreatingTeam(false)}
          onCreate={(created) => {
            setCreatingTeam(false);
            teams.update((data) => ({ teams: [...data.teams, created] }));
            if (route.kind !== "settings")
              navigate(pagePath(`/team/${encodeURIComponent(created.key)}/issues`));
          }}
        />
      )}
    </div>
  );
}

// Chunk loading can fail after a deployment or while offline. Keep navigation usable.
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scope-message">
        <RequestError message="Could not open this page. Reload to try again." />
        <button className="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

export default App;
