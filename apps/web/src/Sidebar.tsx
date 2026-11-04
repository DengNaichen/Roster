import { useCapabilities } from "./Capabilities";
import {
  Orbit,
  DraftingCompass,
  Box,
  Inbox,
  ChevronDown,
  ChevronRight,
  ListTodo,
  Menu,
  Plus,
  Telescope,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { EntityEmoji } from "./EmojiPicker";
import { Session } from "./Session";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { apiPath, NavLink, pagePath, Team, triageChanged, WorkspaceRoute } from "./shared";
import { useResource } from "./useResource";

export function Sidebar({
  route,
  visit,
  teams,
  onCreateTeam,
}: {
  route: WorkspaceRoute;
  visit: number;
  teams: Team[];
  onCreateTeam: () => void;
}) {
  const capabilities = useCapabilities();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [visit]);
  const active = (kind: "issues" | "projects", team = "") =>
    route.kind === kind && route.team === team;
  return (
    <aside className="sidebar scope-sidebar">
      <div className="sidebar-top">
        <WorkspaceMenu />
        <button
          type="button"
          className="button navigation-toggle"
          aria-expanded={expanded}
          aria-controls="workspace-navigation"
          onClick={() => setExpanded(!expanded)}
        >
          <Menu className="icon" />
          Navigation
        </button>
      </div>
      <nav
        id="workspace-navigation"
        className={`scope-navigation ${expanded ? "expanded" : ""}`}
        aria-label="Workspace navigation"
      >
        <div className="sidebar-label">Workspace</div>
        <NavLink
          unavailable={!capabilities.projects}
          className={`nav-item ${active("projects") ? "active" : ""}`}
          to={pagePath("/projects")}
        >
          <Box className="icon" />
          <span className="nav-label">All projects</span>
          {!capabilities.projects && <small>Not migrated</small>}
        </NavLink>
        <NavLink
          unavailable={!capabilities.initiatives}
          className={`nav-item ${route.kind === "initiatives" || route.kind === "initiative" ? "active" : ""}`}
          to={pagePath("/initiatives")}
        >
          <Telescope className="icon" />
          <span className="nav-label">Initiatives</span>
          {!capabilities.initiatives && <small>Not migrated</small>}
        </NavLink>
        <div className="sidebar-label sidebar-heading">
          <span>Teams</span>
          <button
            type="button"
            className="ghost"
            aria-label="Create team"
            title="Create team"
            onClick={onCreateTeam}
          >
            <Plus className="icon" />
          </button>
        </div>
        {teams
          .filter(
            (item) =>
              !item.membership_enabled ||
              item.joined ||
              ("team" in route && route.team === item.key),
          )
          .map((item) => (
            <TeamNavigation key={item.key} team={item} route={route} visit={visit} />
          ))}
      </nav>
      <Session />
    </aside>
  );
}

// Issues waiting for a decision; refreshed on navigation and when issues move in or out.
function useTriageCount(team: string, visit: number) {
  const resource = useResource<{ issues: unknown[] }>(
    apiPath(`/issues?team=${encodeURIComponent(team)}&status=triage&limit=-1`),
    { issues: [] },
  );
  const { reload } = resource;
  const seen = useRef(visit);
  useEffect(() => {
    if (seen.current === visit) return;
    seen.current = visit;
    void reload();
  }, [visit, reload]);
  useEffect(() => {
    const refresh = () => void reload();
    window.addEventListener(triageChanged, refresh);
    return () => window.removeEventListener(triageChanged, refresh);
  }, [reload]);
  return resource.error ? 0 : resource.data.issues.length;
}

function TeamNavigation({
  team,
  route,
  visit,
}: {
  team: Team;
  route: WorkspaceRoute;
  visit: number;
}) {
  const triageCount = useTriageCount(team.key, visit);
  const capabilities = useCapabilities();
  const [expanded, setExpanded] = useState(true);
  const destinationsId = useId();
  const active = (kind: "issues" | "triage" | "projects") =>
    route.kind === kind && route.team === team.key;
  return (
    <section className="team-navigation" aria-label={`${team.name} navigation`}>
      <button
        type="button"
        className="nav-item team-heading"
        aria-expanded={expanded}
        aria-controls={destinationsId}
        onClick={() => setExpanded(!expanded)}
      >
        <EntityEmoji emoji={team.emoji} teamKey={team.key} />
        <span className="nav-label" title={team.name}>
          {team.name}
        </span>
        {expanded ? (
          <ChevronDown className="icon" aria-hidden="true" />
        ) : (
          <ChevronRight className="icon" aria-hidden="true" />
        )}
      </button>
      <div id={destinationsId} className="team-destinations" hidden={!expanded}>
        <NavLink
          className={`nav-item team-destination ${active("triage") ? "active" : ""}`}
          to={pagePath(`/team/${encodeURIComponent(team.key)}/triage`)}
        >
          <Inbox className="icon" />
          <span className="nav-label">Triage</span>
          {triageCount > 0 && <small className="nav-count">{triageCount}</small>}
        </NavLink>
        <NavLink
          className={`nav-item team-destination ${active("issues") ? "active" : ""}`}
          to={pagePath(`/team/${encodeURIComponent(team.key)}/issues`)}
        >
          <ListTodo className="icon" />
          <span className="nav-label">Issues</span>
        </NavLink>
        <NavLink
          className={`nav-item team-destination ${route.kind === "specs" && route.team === team.key ? "active" : ""}`}
          to={pagePath(`/team/${encodeURIComponent(team.key)}/specs`)}
        >
          <DraftingCompass className="icon" />
          <span className="nav-label">Specs</span>
        </NavLink>
        <NavLink
          unavailable={!capabilities.projects}
          className={`nav-item team-destination ${active("projects") ? "active" : ""}`}
          to={pagePath(`/team/${encodeURIComponent(team.key)}/projects`)}
        >
          <Box className="icon" />
          <span className="nav-label">Projects</span>
          {!capabilities.projects && <small>Not migrated</small>}
        </NavLink>
        <NavLink
          unavailable={!capabilities.cycles}
          className={`nav-item team-destination ${(route.kind === "cycles" || route.kind === "cycle") && route.team === team.key ? "active" : ""}`}
          to={pagePath(`/team/${encodeURIComponent(team.key)}/cycles`)}
        >
          <Orbit className="icon" />
          <span className="nav-label">Cycles</span>
          {!capabilities.cycles && <small>Not migrated</small>}
        </NavLink>
      </div>
    </section>
  );
}
