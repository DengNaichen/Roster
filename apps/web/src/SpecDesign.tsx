import { lazy, Suspense, useState } from "react";
import type { Spec, StoredDesign } from "../../../packages/contracts/spec";
import { apiPath, RequestError } from "./shared";
import { useResource } from "./useResource";
import { readDesign, type DesignContent } from "./designContent";
import "./spec-design.css";
const Diagram = lazy(() => import("./DesignDiagram"));
const diagramFields = [
  { key: "sequence", label: "Sequence diagram" },
  { key: "state", label: "State diagram" },
] as const;
const labels = { goals: "Goals", nonGoals: "Non-Goals" };

export function SpecDesign({ spec, storageKey }: { spec: Spec; storageKey: string }) {
  const resource = useResource<{ identifier: string; design: StoredDesign | null } | null>(
    apiPath(`/specs/${encodeURIComponent(spec.identifier)}/design`),
    null,
  );
  const [legacy] = useState(() => {
    try {
      return readDesign(storageKey);
    } catch {
      return null;
    }
  });
  const stored = resource.data?.design;
  const content = stored?.content ?? legacy?.content;
  return (
    <div className="spec-scroll">
      <article className="spec-content design-content">
        <header className="spec-heading">
          <p className="spec-kicker design-kicker">
            Design <span>/</span>
            {spec.identifier}
          </p>
          <h1>{spec.content.title}</h1>
          {resource.data && (
            <p className="spec-kicker">
              {stored
                ? `Design r${stored.revision} · Based on spec r${stored.spec_revision}`
                : legacy
                  ? "Local draft · Read only"
                  : "OpenSpec"}
            </p>
          )}
        </header>
        {resource.error ? (
          <div className="scope-message">
            <RequestError message={resource.error} />
            <button className="button" onClick={() => void resource.reload()}>
              Retry
            </button>
          </div>
        ) : !resource.data ? (
          <p className="empty">Loading design…</p>
        ) : content ? (
          <DesignDocument content={content} />
        ) : (
          <p className="empty">No design yet.</p>
        )}
      </article>
    </div>
  );
}
function DesignItems({ text }: { text: string }) {
  const items = text
    .trim()
    .split(/\r?\n(?:[^\S\r\n]*\r?\n)+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length < 2) return <p className="design-prose">{text}</p>;
  return (
    <ol className="design-prose design-items">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}

function DesignDocument({ content: c }: { content: DesignContent }) {
  const diagrams = c.decisions.flatMap((decision, index) =>
    diagramFields
      .filter(({ key }) => decision[key].trim())
      .map(({ key, label }) => ({
        id: `${index}-${key}`,
        title: decision.title,
        label,
        source: decision[key],
      })),
  );
  return (
    <>
      {c.context && (
        <section className="spec-section">
          <h2>Context</h2>
          <p className="design-prose">{c.context}</p>
        </section>
      )}
      {(c.goals || c.nonGoals) && (
        <section className="spec-section">
          <h2>Goals / Non-Goals</h2>
          <div className="design-goals">
            {(["goals", "nonGoals"] as const).map(
              (k) =>
                c[k] && (
                  <div key={k} className={k === "goals" ? "design-in-scope" : undefined}>
                    <h3 className="spec-subheading">{labels[k]}</h3>
                    <DesignItems text={c[k]} />
                  </div>
                ),
            )}
          </div>
        </section>
      )}
      <section className="spec-section">
        <h2>Decisions</h2>
        <div className="design-decisions">
          {c.decisions.map((d, i) => (
            <article className="design-decision" key={i}>
              <span className="spec-id">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{d.title}</h3>
                <p className="design-prose">{d.reason}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      {c.risks && (
        <section className="spec-section design-risks">
          <h2>Risks / Trade-offs</h2>
          <DesignItems text={c.risks} />
        </section>
      )}
      {c.notes && (
        <details className="design-extras">
          <summary>Supporting notes</summary>
          <p className="design-prose">{c.notes}</p>
        </details>
      )}
      {diagrams.length > 0 && (
        <section className="spec-section">
          <h2>Diagrams</h2>
          {diagrams.map(({ id, title, label, source }) => (
            <figure className="design-plate" key={id}>
              <figcaption className="spec-subheading">
                <span>{label}</span> {title}
              </figcaption>
              <div className="design-figure">
                <Suspense fallback="Loading diagram…">
                  <Diagram key={source} source={source} />
                </Suspense>
              </div>
            </figure>
          ))}
        </section>
      )}
    </>
  );
}
