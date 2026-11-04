import { lazy, Suspense, useState } from "react";
import { Dropdown } from "./Dropdown";
import type { Spec } from "../../../packages/contracts/spec";
import { emptyDesign, exampleDesign, readDesign, type DesignContent } from "./designContent";
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
              {design ? `Based on spec r${design.revision}` : "Example · Spec–issue links"}
            </span>
            <span>Local to this browser</span>
            {!editing && !loaded.error && (
              <>
                <button className="button" onClick={() => edit(design?.content ?? emptyDesign)}>
                  {design ? "Edit design" : "New design"}
                </button>
                {!design && (
                  <button className="button" onClick={() => edit(exampleDesign)}>
                    Use example
                  </button>
                )}
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
              <button className="button" disabled={!draft.approach.trim()} onClick={save}>
                Save design
              </button>
            </div>
            {!preview && (
              <div className="design-fields">
                <label>
                  Design principles
                  <textarea
                    placeholder="Write one implementation rule per line."
                    required
                    value={draft.approach}
                    onChange={(e) => setDraft({ ...draft, approach: e.target.value })}
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
                <details className="design-extras">
                  <summary>Optional diagrams</summary>
                  <div className="design-fields">
                    {diagramFields.map(({ key, label, placeholder }) => (
                      <label key={key}>
                        {label}
                        <textarea
                          className="diagram-source"
                          value={draft[key]}
                          placeholder={placeholder}
                          spellCheck={false}
                          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                        />
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        )}
        {!loaded.error && (!editing || preview) && (
          <DesignDocument content={editing ? draft : (design?.content ?? exampleDesign)} />
        )}
      </article>
    </div>
  );
}

function DesignDocument({ content }: { content: DesignContent }) {
  return (
    <>
      <section className="spec-section">
        <h2>Design principles</h2>
        <ol className="design-principles">
          {content.approach
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .map((line, i) => (
              <li key={i}>{line}</li>
            ))}
        </ol>
      </section>
      {content.notes && (
        <details className="design-extras">
          <summary>Supporting notes</summary>
          <p className="design-prose">{content.notes}</p>
        </details>
      )}
      {diagramFields
        .filter(({ key }) => content[key].trim())
        .map(({ key, label }) => (
          <section className="spec-section" key={key}>
            <h2>{label}</h2>
            <figure className="design-figure">
              <Suspense fallback="Loading diagram…">
                <Diagram key={content[key]} source={content[key]} />
              </Suspense>
            </figure>
          </section>
        ))}
    </>
  );
}
