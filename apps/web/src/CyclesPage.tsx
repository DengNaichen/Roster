import { ReactNode } from "react";
import { Orbit } from "lucide-react";
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
        <Orbit className="icon cycle-crumb-icon" aria-hidden="true" />
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
              <CycleEmpty
                title="Build a steady rhythm"
                hint="Cycles plan work in repeating periods. Completed history stays available here."
              >
                {canManage && (
                  <NavLink className="button primary" to={pagePath("/settings")}>
                    Set up cycles in Settings
                  </NavLink>
                )}
              </CycleEmpty>
            )}
            {resource.data.settings.enabled && cycles.length === 0 && (
              <CycleEmpty
                title="No cycles scheduled"
                hint="Plan a focused set of work. Unfinished committed issues roll into the next cycle."
              />
            )}
            {cycles.length > 0 && <CycleTimeline cycles={cycles} />}
          </>
        )}
      </div>
    </>
  );
}

function CycleEmpty({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className="cycle-empty">
      <Orbit className="icon" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{hint}</p>
      {children}
    </div>
  );
}
