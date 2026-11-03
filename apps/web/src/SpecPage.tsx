import { FileText } from "lucide-react";
import { useState } from "react";
import type { Spec } from "../../../packages/contracts/spec";
import { PageHeader } from "./PageHeader";
import { apiPath, NavLink, pagePath, RequestError, type IssueSummary } from "./shared";
import { useResource } from "./useResource";
import { SpecEditor } from "./SpecEditor";
import SpecDocument from "./SpecDocument";
import { specView } from "./specView";
import SpecIssues from "./SpecIssues";
import "./spec-issues.css";
export default function SpecPage({ id }: { id: string }) {
  const resource = useResource<Spec | null>(apiPath(`/specs/${encodeURIComponent(id)}`), null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).get("section") === "issues" ? "issues" : "overview",
  );
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
        actions={
          spec && (
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
            onLinksChanged={linkedIssues.reload}
          />
        ) : (
          <SpecDocument spec={specView(spec.content, spec.created_at)} />
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
