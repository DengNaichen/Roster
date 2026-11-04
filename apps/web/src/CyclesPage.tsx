import { CalendarRange } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { apiPath, NavLink, pagePath, RequestError, Team } from "./shared";
import { useResource } from "./useResource";
import { CyclePage, emptyCycles } from "./Cycles";
import { CycleTimeline } from "./CycleTimeline";
import "./cycles.css";

export default function CyclesPage({ team, teams }: { team: string; teams: Team[] }) {
  const resource = useResource<CyclePage>(
    apiPath(`/teams/${encodeURIComponent(team)}/cycles`),
    emptyCycles,
  );
  const activeTeam = teams.find((t) => t.key === team);
  const canManage = activeTeam && (!activeTeam.membership_enabled || activeTeam.can_manage);
  const cycles = resource.data.cycles;
  return (
    <>
      <PageHeader>
        <CalendarRange className="icon" />
        <span>{activeTeam?.name ?? team} / Cycles</span>
      </PageHeader>
      <div className="cycle-content">
        {resource.error ? (
          <>
            <RequestError message={resource.error} />
            <button className="button" onClick={() => void resource.reload()}>
              Retry cycles
            </button>
          </>
        ) : resource.loading ? (
          <p className="empty">Loading…</p>
        ) : (
          <>
            {!resource.data.settings.enabled && (
              <div className="cycle-empty">
                <h2>Build a steady rhythm</h2>
                <p>
                  Cycles plan work in repeating periods. Completed history stays available here.
                </p>
                {canManage && (
                  <NavLink className="button primary" to={pagePath("/settings")}>
                    Set up cycles in Settings
                  </NavLink>
                )}
              </div>
            )}
            {resource.data.settings.enabled && cycles.length === 0 && (
              <div className="project-empty">
                <CalendarRange className="icon" aria-hidden="true" />
                <p>No cycles scheduled</p>
                <small>
                  Plan a focused set of work. Unfinished committed issues roll into the next cycle.
                </small>
              </div>
            )}
            {cycles.length > 0 && <CycleTimeline cycles={cycles} />}
          </>
        )}
      </div>
    </>
  );
}
