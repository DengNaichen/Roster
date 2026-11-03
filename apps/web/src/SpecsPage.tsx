import { SpecStatusBadge } from "./SpecStatus";
import { SpecIssueProgress } from "./SpecIssueProgress";
import { EntityEmoji } from "./EmojiPicker";
import { ChevronDown, DraftingCompass } from "lucide-react";
import { type CSSProperties, useState } from "react";
import type { SpecSummary } from "../../../packages/contracts/spec";
import { PageHeader } from "./PageHeader";
import { apiPath, navigate, NavLink, pagePath, RequestError, Team } from "./shared";
import { useResource } from "./useResource";
import { SpecEditor } from "./SpecEditor";
import { emptySpec } from "./specView";
import "./spec-interaction.css";
export default function SpecsPage({ team, teams }: { team: string; teams: Team[] }) {
  const resource = useResource<{ specs: SpecSummary[] }>(
    apiPath(`/specs${team ? `?team=${encodeURIComponent(team)}` : ""}`),
    { specs: [] },
  );
  const [creating, setCreating] = useState(false);
  const visibleTeams = teams.filter((item) => item.accessible);
  const groups = visibleTeams.filter((item) => !team || item.key === team);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const byTeam = new Map<string, SpecSummary[]>();
  for (const spec of resource.data.specs) {
    const group = byTeam.get(spec.team);
    if (group) group.push(spec);
    else byTeam.set(spec.team, [spec]);
  }
  const idWidth = resource.data.specs.reduce(
    (width, spec) => Math.max(width, spec.identifier.length),
    6,
  );
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
        <DraftingCompass className="icon" />
        <span>{team ? `${team} / Specs` : "Specs"}</span>
      </PageHeader>
      <section
        className="spec-directory"
        aria-label="Specs directory"
        style={{ "--spec-id-width": `${idWidth}ch` } as CSSProperties}
      >
        {resource.error && (
          <>
            <RequestError message={resource.error} />
            <button className="button" onClick={() => void resource.reload()}>
              Retry specs
            </button>
          </>
        )}
        {resource.loading && <p className="empty">Loading specs…</p>}
        {!resource.loading &&
          !resource.error &&
          groups.map((item) => {
            const specs = byTeam.get(item.key) ?? [];
            const open = !collapsed.has(item.key);
            const id = `specs-team-${item.key}`;
            return (
              <section key={item.key} className="spec-team" aria-label={item.name}>
                <div className="group-header-wrap">
                  <button
                    type="button"
                    className="group-header"
                    aria-label={`${item.name}, ${specs.length} ${specs.length === 1 ? "spec" : "specs"}`}
                    aria-expanded={open}
                    aria-controls={id}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(item.key)) next.delete(item.key);
                        else next.add(item.key);
                        return next;
                      })
                    }
                  >
                    <ChevronDown className="icon chevron" />
                    <EntityEmoji emoji={item.emoji} teamKey={item.key} />
                    <span className="group-label">
                      {item.name}
                      <small>{specs.length}</small>
                    </span>
                  </button>
                </div>
                <div id={id} className="spec-directory-list" hidden={!open}>
                  {specs.length === 0 && <p className="list-empty">No specs yet.</p>}
                  {specs.map((spec) => (
                    <div className="spec-directory-row" key={spec.identifier}>
                      <NavLink to={pagePath(`/spec/${spec.identifier}`)}>
                        <span className="spec-id">{spec.identifier}</span>
                        <strong>{spec.active_revision?.title ?? spec.title}</strong>
                      </NavLink>
                      <SpecIssueProgress progress={spec.issue_progress} />
                      <span className="spec-row-statuses">
                        <SpecStatusBadge status={spec.active_revision ? "active" : spec.status} />
                        {spec.active_revision && spec.active_revision.number < spec.revision && (
                          <SpecStatusBadge status={spec.status} revision={spec.revision} />
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        {visibleTeams.length === 0 && (
          <p className="dialog-hint">Create or join a team before creating a spec.</p>
        )}
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
