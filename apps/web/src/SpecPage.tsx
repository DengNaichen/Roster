import { FileText } from "lucide-react";
import { useState } from "react";
import type { Spec } from "../../../packages/contracts/spec";
import { PageHeader } from "./PageHeader";
import { apiPath, NavLink, pagePath, RequestError } from "./shared";
import { useResource } from "./useResource";
import { SpecEditor } from "./SpecEditor";
import SpecDocument from "./SpecDocument";
import { specView } from "./specView";
import SpecIssuesPrototype, { prototypeLinks } from "./SpecIssuesPrototype";
import "./spec-prototype.css";
export default function SpecPage({ id }: { id: string }) {
  const resource = useResource<Spec | null>(apiPath(`/specs/${encodeURIComponent(id)}`), null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).get("section") === "issues" ? "issues" : "overview",
  );
  const [issueCount, setIssueCount] = useState(() => prototypeLinks(id).length);
  const prototype = import.meta.env.DEV && import.meta.env.VITE_LOCAL_PREVIEW === "true";
  const spec = resource.data?.identifier === id ? resource.data : null;
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
      {spec && prototype && (
        <div className="project-toolbar project-tabs">
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
        </div>
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
        (prototype && tab === "issues" ? (
          <SpecIssuesPrototype
            key={id}
            id={id}
            team={spec.team}
            title={spec.content.title}
            onCount={setIssueCount}
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
