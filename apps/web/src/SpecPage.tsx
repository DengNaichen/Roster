import { FileText } from "lucide-react";
import { useState } from "react";
import type { Spec, SpecRevision } from "../../../packages/contracts/spec";
import { SpecDesign } from "./SpecDesign";
import { useSession } from "./integration/auth";
import { PageHeader } from "./PageHeader";
import { apiPath, NavLink, pagePath, RequestError, type IssueSummary } from "./shared";
import { useResource } from "./useResource";
import { SpecEditor } from "./SpecEditor";
import { SpecStatusBadge } from "./SpecStatus";
import SpecDocument from "./SpecDocument";
import { specView } from "./specView";
import SpecIssues from "./SpecIssues";
import "./spec-issues.css";
export default function SpecPage({ id }: { id: string }) {
  const resource = useResource<Spec | null>(apiPath(`/specs/${encodeURIComponent(id)}`), null);
  const [editing, setEditing] = useState(false);
  const section = new URLSearchParams(window.location.search).get("section");
  const [tab, selectTab] = useState<string>(
    section === "design" || section === "issues" ? section : "overview",
  );
  const { identity } = useSession();
  function setTab(value: string) {
    const url = new URL(window.location.href);
    if (value === "overview") url.searchParams.delete("section");
    else url.searchParams.set("section", value);
    window.history.replaceState(window.history.state, "", url);
    selectTab(value);
  }
  const linkedIssues = useResource<{ issues: IssueSummary[] }>(
    apiPath(`/specs/${encodeURIComponent(id)}/issues?limit=-1`),
    { issues: [] },
  );
  const issueCount = linkedIssues.data.issues.length;
  const spec = resource.data?.identifier === id ? resource.data : null;
  const sectionTabs = (
    <div className="segmented" role="tablist" aria-label="Spec sections">
      {[
        ["overview", "Overview"],
        ["design", "Plan"],
        ["issues", `Issues · ${issueCount}`],
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          aria-pressed={tab === value}
          onClick={() => setTab(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <PageHeader
        className="spec-page-header"
        actions={
          spec &&
          tab !== "design" && (
            <div className="spec-action-row">
              <button className="button" onClick={() => setEditing(true)}>
                Edit spec
              </button>
            </div>
          )
        }
      >
        <FileText className="icon" />
        <NavLink to={pagePath("/specs")}>Specs</NavLink>
        <span>/ {id}</span>
      </PageHeader>
      {spec && tab !== "issues" && (
        <div className="project-toolbar project-tabs spec-page-tabs">{sectionTabs}</div>
      )}
      {resource.error && (
        <div className="scope-message">
          <RequestError message={resource.error} />
          <button className="button" onClick={() => void resource.reload()}>
            Retry spec
          </button>
        </div>
      )}
      {!spec && resource.loading && <p className="empty">Loading spec…</p>}
      {spec &&
        (tab === "issues" ? (
          <SpecIssues
            key={id}
            id={id}
            team={spec.team}
            tabs={sectionTabs}
            linked={linkedIssues.data.issues.map((issue) => issue.identifier)}
            linksError={linkedIssues.error}
            onLinksChanged={async () => {
              await Promise.all([linkedIssues.reload(), resource.reload()]);
            }}
          />
        ) : tab === "design" ? (
          <SpecDesign
            key={apiPath(id) + identity?.subject}
            spec={spec}
            openIssues={() => setTab("issues")}
            storageKey={`roster-design:${identity?.subject}:${apiPath(id)}`}
          />
        ) : (
          <SpecOverview key={`overview-${id}`} spec={spec} />
        ))}
      {editing && spec && (
        <SpecEditor
          key={id}
          initial={spec.content}
          spec={spec}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            resource.update(() => saved);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

// Keep the editable head separate from the adopted text that readers land on.
function SpecOverview({ spec }: { spec: Spec }) {
  const active =
    spec.active_revision && spec.active_revision.number < spec.revision
      ? spec.active_revision
      : null;
  const [showLatest, setShowLatest] = useState(false);
  const readActive = !!active && !showLatest;
  const saved = useResource<SpecRevision | null>(
    readActive ? apiPath(`/specs/${spec.identifier}/revisions/${active.number}`) : null,
    null,
  );
  const content = readActive
    ? saved.data?.number === active.number
      ? saved.data.content
      : null
    : spec.content;
  return (
    <>
      {active && (
        <div
          className="project-toolbar spec-reading-version"
          role="group"
          aria-label="Choose spec revision"
        >
          <span>Version</span>
          <button type="button" aria-pressed={readActive} onClick={() => setShowLatest(false)}>
            <SpecStatusBadge status="active" revision={active.number} />
          </button>
          <button type="button" aria-pressed={!readActive} onClick={() => setShowLatest(true)}>
            <SpecStatusBadge status={spec.content.status} revision={spec.revision} />
          </button>
        </div>
      )}
      {readActive && saved.error ? (
        <div className="scope-message">
          <RequestError message={saved.error} />
          <button className="button" onClick={() => void saved.reload()}>
            Retry active revision
          </button>
        </div>
      ) : content ? (
        <SpecDocument progress={spec.issue_progress} spec={specView(content, spec.created_at)} />
      ) : (
        <p className="empty">Loading active revision…</p>
      )}
    </>
  );
}
