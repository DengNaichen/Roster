import { lazy, Suspense, useState } from "react";
import { Dropdown } from "./Dropdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Spec } from "../../../packages/contracts/spec";
import "./spec-design.css";

const Diagram = lazy(() => import("./DesignDiagram"));
const components = {
  code({ className, children }: { className?: string; children?: React.ReactNode }) {
    if (className !== "language-mermaid") return <code className={className}>{children}</code>;
    const source = String(children);
    return (
      <Suspense fallback="Loading diagram…">
        <Diagram key={source} source={source} />
      </Suspense>
    );
  },
};
const example = [
  "## Approach",
  "Track each linked pull request independently. Re-evaluate the issue after each merge event.",
  "## Sequence",
  "```mermaid",
  "sequenceDiagram",
  "  participant GitHub",
  "  participant Roster",
  "  participant Issue",
  "  GitHub->>Roster: Pull request merged",
  "  Roster->>Roster: Read all linked pull requests",
  "  alt All merged",
  "    Roster->>Issue: Mark eligible issue done",
  "  else Another PR is open",
  "    Roster-->>Issue: Keep in review",
  "  end",
  "```",
  "## State transitions",
  "```mermaid",
  "stateDiagram-v2",
  "  InReview --> InReview: Another PR is open",
  "  InReview --> Done: All PRs merged",
  "  InReview --> Canceled: Manually canceled",
  "```",
  "## Verification",
  "Link two pull requests. Merge the first and verify the issue stays in review. Replay the event and verify its state is unchanged.",
].join("\n");

type Design = { body: string; revision: number };
function readDesign(key: string): Design | null {
  const value = JSON.parse(localStorage.getItem(key) ?? "null");
  if (value === null) return null;
  if (typeof value.body !== "string" || !Number.isInteger(value.revision))
    throw new Error("Invalid design");
  return value;
}

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
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState(loaded.error);
  const [base, setBase] = useState(
    design?.revision ?? spec.active_revision?.number ?? spec.revision,
  );
  function edit(body: string) {
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
      const next = { body: draft.trim(), revision: base };
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
                <button
                  className="button"
                  onClick={() =>
                    edit(
                      design?.body ??
                        "## Approach\n\n## Sequence\n\n## State transitions\n\n## Verification\n",
                    )
                  }
                >
                  {design ? "Edit design" : "New design"}
                </button>
                {!design && (
                  <button className="button" onClick={() => edit(example)}>
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
              <button className="button" disabled={!draft.trim()} onClick={save}>
                Save design
              </button>
            </div>
            {!preview && (
              <label>
                Design in Markdown
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                />
              </label>
            )}
          </div>
        )}
        {!loaded.error && (!editing || preview) && (
          <section className="markdown design-body">
            <Markdown remarkPlugins={[remarkGfm]} components={components}>
              {editing ? draft : (design?.body ?? example)}
            </Markdown>
          </section>
        )}
      </article>
    </div>
  );
}
