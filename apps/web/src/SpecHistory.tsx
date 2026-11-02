import { Dropdown } from "./Dropdown";
import { useState } from "react";
import type { Spec, SpecRevision, SpecRevisionSummary } from "../../../packages/contracts/spec";
import { apiPath, personName, RequestError } from "./shared";
import { useResource } from "./useResource";
import SpecDocument from "./SpecDocument";
import { compareSpecContent, specView } from "./specView";
import "./spec-interaction.css";
export function SpecHistory({ spec }: { spec: Spec }) {
  const path = apiPath(`/specs/${spec.identifier}/revisions`);
  const history = useResource<{ revisions: SpecRevisionSummary[] }>(path, {
    revisions: [],
  });
  const [selected, setSelected] = useState(spec.revision);
  const [from, setFrom] = useState(Math.max(1, spec.revision - 1));
  const [to, setTo] = useState(spec.revision);
  const [comparing, setComparing] = useState(false);
  const revision = useResource<SpecRevision | null>(
    !comparing ? `${path}/${selected}` : null,
    null,
  );
  const before = useResource<SpecRevision | null>(comparing ? `${path}/${from}` : null, null);
  const after = useResource<SpecRevision | null>(comparing ? `${path}/${to}` : null, null);
  const current = revision.data?.number === selected ? revision.data : null;
  const difference =
    before.data?.number === from && after.data?.number === to
      ? compareSpecContent(before.data.content, after.data.content)
      : null;
  return (
    <section className="spec-history" aria-label="Revision history">
      <h2>Revision history</h2>
      {history.error && (
        <>
          <RequestError message={history.error} />
          <button className="button" onClick={() => void history.reload()}>
            Retry revision history
          </button>
        </>
      )}
      {history.loading && <p className="empty">Loading revisions…</p>}
      {history.data.revisions.length > 0 && (
        <>
          <div className="spec-history-controls">
            <button className="button" onClick={() => setComparing(!comparing)}>
              {comparing ? "Read a revision" : "Compare revisions"}
            </button>
            {!comparing ? (
              <label>
                Revision
                <Dropdown
                  variant="block"
                  aria-label="Revision"
                  value={String(selected)}
                  onChange={(next) => setSelected(Number(next))}
                  options={history.data.revisions.map((item) => ({
                    value: String(item.number),
                    label: `r${item.number} · ${item.message || "No message"}`,
                  }))}
                />
              </label>
            ) : (
              <>
                <label>
                  From revision
                  <Dropdown
                    variant="block"
                    aria-label="From revision"
                    value={String(from)}
                    onChange={(next) => setFrom(Number(next))}
                    options={history.data.revisions.map((item) => ({
                      value: String(item.number),
                      label: `r${item.number}`,
                    }))}
                  />
                </label>
                <label>
                  To revision
                  <Dropdown
                    variant="block"
                    aria-label="To revision"
                    value={String(to)}
                    onChange={(next) => setTo(Number(next))}
                    options={history.data.revisions.map((item) => ({
                      value: String(item.number),
                      label: `r${item.number}`,
                    }))}
                  />
                </label>
              </>
            )}
          </div>
          {!comparing ? (
            <>
              {revision.error && (
                <>
                  <RequestError message={revision.error} />
                  <button className="button" onClick={() => void revision.reload()}>
                    Retry revision
                  </button>
                </>
              )}
              {revision.loading && <p>Loading revision…</p>}
              {current && (
                <>
                  <p className="spec-revision-meta">
                    r{current.number} · {current.author ? personName(current.author) : "System"} ·{" "}
                    {new Date(current.created_at).toLocaleString()} · {current.message}
                  </p>
                  <SpecDocument spec={specView(current.content, spec.created_at)} />
                </>
              )}
            </>
          ) : (
            <>
              {(before.error || after.error) && (
                <>
                  <RequestError message={before.error || after.error} />
                  <button
                    className="button"
                    onClick={() => {
                      void before.reload();
                      void after.reload();
                    }}
                  >
                    Retry comparison
                  </button>
                </>
              )}
              {(before.loading || after.loading) && <p>Loading comparison…</p>}
              {difference && (
                <>
                  <h3>
                    r{from} → r{to}
                  </h3>
                  <p className="dialog-hint">
                    User stories, functional requirements and success criteria matched by stable ID.
                  </p>
                  {difference.length === 0 ? (
                    <p>These revisions have no entries in the compared sections.</p>
                  ) : (
                    difference.map((entry) => (
                      <article
                        className={`spec-diff-entry ${entry.kind}`}
                        key={`${entry.section}/${entry.id}`}
                      >
                        <h4>
                          {entry.section} {entry.id} · {entry.kind}
                        </h4>
                        {entry.kind === "unchanged" ? (
                          <details>
                            <summary>Unchanged content</summary>
                            <p>{entry.after}</p>
                          </details>
                        ) : (
                          <>
                            {entry.before && (
                              <del aria-label={`Previous ${entry.id}`}>{entry.before}</del>
                            )}
                            {entry.after && <ins aria-label={`New ${entry.id}`}>{entry.after}</ins>}
                          </>
                        )}
                      </article>
                    ))
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
