import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { apiPath, NavLink, pagePath, RequestError, Team } from "./shared";
import { useResource } from "./useResource";
import {
  CyclePage,
  CycleSettingsDialog,
  cycleDates,
  cycleName,
  cyclePath,
  emptyCycles,
} from "./Cycles";
import "./cycles.css";

export default function CyclesPage({ team, teams }: { team: string; teams: Team[] }) {
  const resource = useResource<CyclePage>(
    apiPath(`/teams/${encodeURIComponent(team)}/cycles`),
    emptyCycles,
  );
  const [configuring, setConfiguring] = useState(false);
  const [past, setPast] = useState(false);
  const activeTeam = teams.find((t) => t.key === team);
  const canManage = activeTeam && (!activeTeam.membership_enabled || activeTeam.can_manage);
  const cycles = resource.data.cycles
    .filter((c) => (past ? c.state === "completed" : c.state !== "completed"))
    .sort((a, b) => (past ? b.number - a.number : a.number - b.number));
  return (
    <>
      <PageHeader
        actions={
          canManage && (
            <button
              className="button"
              disabled={resource.loading || !!resource.error}
              onClick={() => setConfiguring(true)}
            >
              Cycle settings
            </button>
          )
        }
      >
        <CalendarRange className="icon" />
        <span>{activeTeam?.name ?? team} / Cycles</span>
      </PageHeader>
      <div className="project-toolbar">
        <div className="segmented" role="group" aria-label="Cycle status">
          <button type="button" aria-pressed={!past} onClick={() => setPast(false)}>
            Current &amp; upcoming
          </button>
          <button type="button" aria-pressed={past} onClick={() => setPast(true)}>
            Completed
          </button>
        </div>
      </div>
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
                  Enable cycles to plan work in repeating periods. Completed history stays available
                  here.
                </p>
                {canManage && (
                  <button className="button primary" onClick={() => setConfiguring(true)}>
                    Enable cycles
                  </button>
                )}
              </div>
            )}
            {cycles.length === 0 && resource.data.settings.enabled && (
              <div className="project-empty">
                <CalendarRange className="icon" aria-hidden="true" />
                <p>No {past ? "completed" : "scheduled"} cycles</p>
                <small>
                  Plan a focused set of work. Unfinished committed issues roll into the next cycle.
                </small>
              </div>
            )}
            {cycles.length > 0 && (
              <div className="cycle-list">
                <div className="cycle-list-head" aria-hidden="true">
                  <span>Cycle</span>
                  <span>Dates</span>
                  <span>Progress</span>
                </div>
                {cycles.map((cycle) => (
                  <NavLink
                    className={`cycle-card ${cycle.state}`}
                    key={cycle.id}
                    to={pagePath(cyclePath(cycle))}
                  >
                    <div className="cycle-card-heading">
                      <span className="cycle-state">{cycle.state}</span>
                      <h2>{cycleName(cycle)}</h2>
                    </div>
                    <span className="cycle-dates">{cycleDates(cycle)}</span>
                    <div className="cycle-progress">
                      <div
                        className="cycle-bar"
                        role="progressbar"
                        aria-label={`${cycleName(cycle)} completion`}
                        aria-valuemin={0}
                        aria-valuemax={Math.max(cycle.total, 1)}
                        aria-valuenow={cycle.done}
                      >
                        <span
                          style={{
                            width: `${Math.min(100, (cycle.done / Math.max(cycle.total, 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      <span>
                        {cycle.done} / {cycle.total}
                      </span>
                    </div>
                    {cycle.description && <p>{cycle.description}</p>}
                    {cycle.state === "completed" && (
                      <small>
                        {cycle.rolled_over} carried over · {cycle.canceled} canceled · completion
                        snapshot
                      </small>
                    )}
                  </NavLink>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {configuring && (
        <CycleSettingsDialog
          team={team}
          settings={resource.data.settings}
          onClose={() => setConfiguring(false)}
          onSaved={(page) => {
            resource.update(() => page);
            setConfiguring(false);
          }}
        />
      )}
    </>
  );
}
