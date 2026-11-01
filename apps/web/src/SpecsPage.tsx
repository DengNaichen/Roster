import { FileText } from "lucide-react";
import { useState } from "react";
import type { SpecSummary } from "../../../packages/contracts/spec";
import { PageHeader } from "./PageHeader";
import {
  apiPath,
  navigate,
  NavLink,
  pagePath,
  RequestError,
  Team,
} from "./shared";
import { useResource } from "./useResource";
import { SpecEditor } from "./SpecEditor";
import { emptySpec } from "./specView";
import "./spec-interaction.css";
export default function SpecsPage(
  { team, teams }: { team: string; teams: Team[] },
) {
  const resource = useResource<{ specs: SpecSummary[] }>(
    apiPath(`/specs${team ? `?team=${encodeURIComponent(team)}` : ""}`),
    { specs: [] },
  );
  const [creating, setCreating] = useState(false);
  const visibleTeams = teams.filter((item) => item.accessible);
  return (
    <>
      <PageHeader
        actions={
          <button
            className="button"
            disabled={visibleTeams.length === 0}
            onClick={() => setCreating(true)}
          >
            New spec
          </button>
        }
      >
        <FileText className="icon" />
        <span>{team ? `${team} / Specs` : "Specs"}</span>
      </PageHeader>
      <section className="spec-directory" aria-label="Specs directory">
        <label>
          Team scope<select
            value={team}
            onChange={(event) =>
              navigate(pagePath(
                event.target.value
                  ? `/team/${encodeURIComponent(event.target.value)}/specs`
                  : "/specs",
              ))}
          >
            <option value="">All teams</option>
            {visibleTeams.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name} ({item.key})
              </option>
            ))}
          </select>
        </label>
        {resource.error && (
          <>
            <RequestError message={resource.error} />
            <button className="button" onClick={() => void resource.reload()}>
              Retry specs
            </button>
          </>
        )}
        {resource.loading && <p className="empty">Loading specs…</p>}
        {!resource.loading && !resource.error &&
          resource.data.specs.length === 0 && (
          <p className="empty">No specs in this scope yet.</p>
        )}
        {visibleTeams.length === 0 && (
          <p className="dialog-hint">
            Create or join a team before creating a spec.
          </p>
        )}
        <div className="spec-directory-list">
          {resource.data.specs.map((spec) => (
            <NavLink
              key={spec.identifier}
              to={pagePath(`/spec/${spec.identifier}`)}
            >
              <span className="spec-id">{spec.identifier}</span>
              <strong>{spec.title}</strong>
              <span className={`spec-status ${spec.status}`}>
                {spec.status}
              </span>
              <small>
                {spec.team} · r{spec.revision} ·{" "}
                {new Date(spec.updated_at).toLocaleDateString()}
              </small>
            </NavLink>
          ))}
        </div>
      </section>
      {creating && (
        <SpecEditor
          initial={emptySpec()}
          team={team}
          teams={visibleTeams}
          onClose={() => setCreating(false)}
          onSaved={(spec) => navigate(pagePath(`/spec/${spec.identifier}`))}
        />
      )}
    </>
  );
}
