import { FileText } from "lucide-react";
import { useState } from "react";
import type { Spec } from "../../../packages/contracts/spec";
import { PageHeader } from "./PageHeader";
import { apiPath, NavLink, pagePath, RequestError } from "./shared";
import { useResource } from "./useResource";
import { SpecEditor } from "./SpecEditor";
import SpecDocument from "./SpecDocument";
import { SpecHistory } from "./SpecHistory";
import { specView } from "./specView";
export default function SpecPage({ id }: { id: string }) {
  const resource = useResource<Spec | null>(apiPath(`/specs/${encodeURIComponent(id)}`), null);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const spec = resource.data?.identifier === id ? resource.data : null;
  return (
    <>
      <PageHeader
        actions={
          spec && (
            <div className="spec-action-row">
              <button className="button" onClick={() => setHistory(!history)}>
                {history ? "Current content" : "Revision history"}
              </button>
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
        (history ? (
          <SpecHistory key={`${id}/${spec.revision}`} spec={spec} />
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
