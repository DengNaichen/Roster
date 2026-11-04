import { lazy, Suspense, useState } from "react";
import { Dropdown } from "./Dropdown";
import type { Spec } from "../../../packages/contracts/spec";
import { localPreview } from "./integration/preview";
import { workspaceSlug } from "./shared";
import {
  blankDecision,
  type Decision,
  emptyDesign,
  exampleDesign,
  readDesign,
  type DesignContent,
} from "./designContent";
import "./spec-design.css";

const Diagram = lazy(() => import("./DesignDiagram"));
const diagramFields = [
  { key: "sequence", label: "Sequence diagram", placeholder: "sequenceDiagram" },
  { key: "state", label: "State diagram", placeholder: "stateDiagram-v2" },
] as const;

export function SpecDesign({ spec, storageKey }: { spec: Spec; storageKey: string }) {
  const [loaded] = useState(() => {
    try {
      return { design: readDesign(storageKey), error: "" };
    } catch {
      return {
        design: null,
        error: "Could not read the local design. Check browser storage and reload.",
      };
    }
  });
  const [design, setDesign] = useState(loaded.design);
  const seed =
    localPreview && workspaceSlug() === "roster" && spec.identifier === "SPEC-1"
      ? exampleDesign
      : null;
  const current = design?.content ?? seed;
  const [draft, setDraft] = useState(emptyDesign);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState(loaded.error);
  const [base, setBase] = useState(
    design?.revision ?? spec.active_revision?.number ?? spec.revision,
  );
  function edit(body: DesignContent) {
    setDraft(body);
    setBase(design?.revision ?? spec.active_revision?.number ?? spec.revision);
    setPreview(false);
    setEditing(true);
  }
  function updateDecision(index: number, change: Partial<Decision>) {
    setDraft({
      ...draft,
      decisions: draft.decisions.map((d, i) => (i === index ? { ...d, ...change } : d)),
    });
  }
  function save() {
    try {
      if (JSON.stringify(readDesign(storageKey)) !== JSON.stringify(design)) {
        setError("This design changed in another tab. Copy your edits and reload before saving.");
        return;
      }
      const next = { content: draft, revision: base };
      localStorage.setItem(storageKey, JSON.stringify(next));
      setDesign(next);
      setEditing(false);
      setError("");
    } catch {
      setError("Could not save the design. Your edits are still in the editor.");
    }
  }
  return (
    <div className="spec-scroll">
      <article className="spec-content design-content">
        <header className="spec-heading">
          <p className="spec-kicker">Design · {spec.identifier}</p>
          <h1>{spec.content.title}</h1>
          <div className="design-tools">
            <span>
              {design
                ? `Based on spec r${design.revision}`
                : seed
                  ? "OpenSpec · Demo design"
                  : "OpenSpec"}
            </span>
            <span>Local to this browser</span>
            {!editing && !loaded.error && (
              <>
                <button className="button" onClick={() => edit(current ?? emptyDesign)}>
                  {current ? "Edit design" : "New design"}
                </button>
              </>
            )}
          </div>
        </header>
        {error && <p role="alert">{error}</p>}
        {editing && (
          <div className="design-editor">
            <div className="design-tools">
              <span>Based on spec revision</span>
              <Dropdown
                aria-label="Based on spec revision"
                value={String(base)}
                onChange={(value) => setBase(Number(value))}
                options={[
                  ...new Set([design?.revision, spec.active_revision?.number, spec.revision]),
                ]
                  .filter((n): n is number => typeof n === "number")
                  .map((n) => ({ value: String(n), label: `r${n}` }))}
              />
              <button className="button" onClick={() => setPreview(!preview)}>
                {preview ? "Write" : "Preview"}
              </button>
              <button className="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                className="button"
                disabled={!draft.decisions.every((d) => d.title.trim())}
                onClick={save}
              >
                Save design
              </button>
            </div>
            {!preview && (
              <div className="design-fields">
                {(["context", "goals", "nonGoals"] as const).map((key) => (
                  <label key={key}>
                    {labels[key]}
                    <textarea
                      value={draft[key]}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    />
                  </label>
                ))}
                <h2>Decisions</h2>
                {draft.decisions.map((d, i) => (
                  <fieldset className="spec-story design-fields" key={i}>
                    <legend>Decision {i + 1}</legend>
                    <label>
                      Decision title
                      <input
                        value={d.title}
                        onChange={(e) => updateDecision(i, { title: e.target.value })}
                      />
                    </label>
                    <label>
                      Reason and alternatives
                      <textarea
                        value={d.reason}
                        onChange={(e) => updateDecision(i, { reason: e.target.value })}
                      />
                    </label>
                    <details className="design-extras">
                      <summary>Optional diagrams</summary>
                      <div className="design-fields">
                        {diagramFields.map(({ key, label, placeholder }) => (
                          <label key={key}>
                            {label}
                            <textarea
                              value={d[key]}
                              placeholder={placeholder}
                              onChange={(e) => updateDecision(i, { [key]: e.target.value })}
                            />
                          </label>
                        ))}
                      </div>
                    </details>
                    {draft.decisions.length > 1 && (
                      <button
                        className="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            decisions: draft.decisions.filter((_, j) => i !== j),
                          })
                        }
                      >
                        Remove decision
                      </button>
                    )}
                  </fieldset>
                ))}
                <button
                  className="button"
                  onClick={() =>
                    setDraft({ ...draft, decisions: [...draft.decisions, blankDecision] })
                  }
                >
                  Add decision
                </button>
                <label>
                  Risks / Trade-offs
                  <textarea
                    value={draft.risks}
                    onChange={(e) => setDraft({ ...draft, risks: e.target.value })}
                  />
                </label>
                {draft.notes !== undefined && (
                  <label>
                    Supporting notes
                    <textarea
                      value={draft.notes}
                      onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    />
                  </label>
                )}
              </div>
            )}
          </div>
        )}
        {!loaded.error && (!editing || preview) && (editing || current) && (
          <DesignDocument content={editing ? draft : (current ?? emptyDesign)} />
        )}
      </article>
    </div>
  );
}

const labels = { context: "Context", goals: "Goals", nonGoals: "Non-Goals" };
function DesignDocument({ content: c }: { content: DesignContent }) {
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
          {(["goals", "nonGoals"] as const).map(
            (k) =>
              c[k] && (
                <div key={k}>
                  <h3 className="spec-subheading">{labels[k]}</h3>
                  <p className="design-prose">{c[k]}</p>
                </div>
              ),
          )}
        </section>
      )}
      <section className="spec-section">
        <h2>Decisions</h2>
        <div className="spec-stories">
          {c.decisions.map((d, i) => (
            <article className="spec-story" key={i}>
              <header>
                <span className="spec-id">{String(i + 1).padStart(2, "0")}</span>
                <h3>{d.title}</h3>
              </header>
              <p className="design-prose">{d.reason}</p>
              {diagramFields
                .filter(({ key }) => d[key].trim())
                .map(({ key, label }) => (
                  <details className="design-extras" key={key}>
                    <summary>{label}</summary>
                    <figure className="design-figure">
                      <Suspense fallback="Loading diagram…">
                        <Diagram source={d[key]} key={d[key]} />
                      </Suspense>
                    </figure>
                  </details>
                ))}
            </article>
          ))}
        </div>
      </section>
      {c.risks && (
        <section className="spec-section">
          <h2>Risks / Trade-offs</h2>
          <p className="design-prose">{c.risks}</p>
        </section>
      )}
      {c.notes && (
        <details className="design-extras">
          <summary>Supporting notes</summary>
          <p className="design-prose">{c.notes}</p>
        </details>
      )}
    </>
  );
}
