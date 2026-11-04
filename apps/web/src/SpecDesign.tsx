import { lazy, Suspense, useState } from "react";
import { Dropdown } from "./Dropdown";
import type { Spec } from "../../../packages/contracts/spec";
import {
  blankScenario,
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
const parts = ["given", "when", "then"] as const;

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
          <p className="spec-kicker">Technical design · {spec.identifier}</p>
          <h1>{spec.content.title}</h1>
          <div className="design-tools">
            <span>
              {design ? `Based on spec r${design.revision}` : "Example · PR merge handling"}
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
                  Implementation approach
                  <textarea
                    required
                    value={draft.approach}
                    onChange={(e) => setDraft({ ...draft, approach: e.target.value })}
                  />
                </label>
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
                <section className="spec-section">
                  <h2>Verification scenarios</h2>
                  {draft.scenarios.map((scenario, i) => (
                    <fieldset className="spec-story design-fields" key={i}>
                      <legend>Scenario {i + 1}</legend>
                      {parts.map((part) => (
                        <label key={part}>
                          {part}
                          <textarea
                            value={scenario[part]}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                scenarios: draft.scenarios.map((s, j) =>
                                  i === j ? { ...s, [part]: e.target.value } : s,
                                ),
                              })
                            }
                          />
                        </label>
                      ))}
                      <button
                        className="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            scenarios: draft.scenarios.filter((_, j) => j !== i),
                          })
                        }
                      >
                        Remove scenario
                      </button>
                    </fieldset>
                  ))}
                  <button
                    className="button"
                    onClick={() =>
                      setDraft({ ...draft, scenarios: [...draft.scenarios, { ...blankScenario }] })
                    }
                  >
                    Add scenario
                  </button>
                </section>
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
        <h2>Implementation approach</h2>
        <p className="design-prose">{content.approach || "No approach yet."}</p>
      </section>
      {diagramFields.map(({ key, label }) => (
        <section className="spec-section" key={key}>
          <h2>{label}</h2>
          {content[key].trim() ? (
            <figure className="design-figure">
              <Suspense fallback="Loading diagram…">
                <Diagram key={content[key]} source={content[key]} />
              </Suspense>
            </figure>
          ) : (
            <p>No diagram yet.</p>
          )}
        </section>
      ))}
      <section className="spec-section">
        <h2>Verification scenarios</h2>
        {content.scenarios.length ? (
          <ol className="spec-scenarios">
            {content.scenarios.map((s, i) => (
              <li key={i}>
                {parts.map(
                  (part) =>
                    s[part] && (
                      <span className="design-prose" key={part}>
                        <b>{part[0].toUpperCase() + part.slice(1)}</b> {s[part]}
                      </span>
                    ),
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p>No scenarios yet.</p>
        )}
      </section>
    </>
  );
}
