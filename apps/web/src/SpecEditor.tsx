import { FormEvent, useEffect, useRef, useState } from "react";
import type { Spec, SpecContent } from "../../../packages/contracts/spec";
import { api, apiPath, ModalDialog, RequestError, Team } from "./shared";
import SpecDocument from "./SpecDocument";
import { rebaseSpecDraft, specView } from "./specView";
import "./spec-interaction.css";

type EditorProps = {
  initial: SpecContent;
  spec?: Spec;
  teams?: Team[];
  team?: string;
  onClose: () => void;
  onSaved: (spec: Spec) => void;
};
export function SpecEditor(
  { initial, spec, teams = [], team: initialTeam = "", onClose, onSaved }:
    EditorProps,
) {
  const [draft, setDraft] = useState<SpecContent>(() =>
    structuredClone(initial)
  );
  const [team, setTeam] = useState(initialTeam);
  const [baseRevision, setBaseRevision] = useState(spec?.revision ?? 0);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Spec | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const baseline = useRef<SpecContent>(structuredClone(initial));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const usedIds = useRef(
    new Set(
      [...initial.requirements, ...initial.success_criteria].map((item) =>
        item.id
      ),
    ),
  );
  const nextID = (prefix: string) => {
    let number = Math.max(
      0,
      ...Array.from(usedIds.current).filter((id) => id.startsWith(prefix + "-"))
        .map((id) => Number(id.slice(prefix.length + 1))),
    ) + 1;
    while (usedIds.current.has(`${prefix}-${number}`)) number++;
    const id = `${prefix}-${number}`;
    usedIds.current.add(id);
    return id;
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || reviewing || conflict) return;
    setSaving(true);
    setError("");
    try {
      const saved = spec
        ? await api<Spec>(apiPath(`/specs/${spec.identifier}`), "PUT", {
          base_revision: baseRevision,
          content: draft,
          message,
        })
        : await api<Spec>(apiPath("/specs"), "POST", {
          team,
          content: draft,
          message,
        });
      if (mounted.current) onSaved(saved);
    } catch (cause) {
      if (!mounted.current) return;
      const failure = cause as Error & { status?: number; code?: string };
      setError(failure.message);
      setConflict(failure.status === 409 || failure.code === "conflict");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  async function reviewLatest() {
    if (!spec) return;
    setReviewing(true);
    setError("");
    try {
      const value = await api<Spec>(apiPath(`/specs/${spec.identifier}`));
      if (mounted.current) setLatest(value);
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setReviewing(false);
    }
  }
  return (
    <ModalDialog
      className="issue-dialog spec-editor"
      aria-labelledby="spec-editor-title"
      restoreFocus
      onClose={() => {
        if (!saving && !reviewing) onClose();
      }}
    >
      <form onSubmit={save}>
        <header>
          <h2 id="spec-editor-title">
            {spec ? `Edit ${spec.identifier}` : "New spec"}
          </h2>
          <button
            type="button"
            className="ghost"
            aria-label="Close spec editor"
            disabled={saving || reviewing}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <fieldset disabled={saving || reviewing} className="spec-editor-fields">
          {!spec && (
            <label>
              Team<select
                required
                value={team}
                onChange={(event) => setTeam(event.target.value)}
              >
                <option value="">Choose a team…</option>
                {teams.filter((item) => item.accessible).map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.name} ({item.key})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Title<input
              required
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))}
            />
          </label>
          <div className="spec-editor-row">
            <label>
              Status<select
                value={draft.status}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    status: event.target.value as SpecContent["status"],
                  }))}
              >
                {["draft", "review", "approved", "superseded"].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label>
              Branch<input
                value={draft.branch ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    branch: event.target.value,
                  }))}
              />
            </label>
          </div>
          <section>
            <h3>Functional requirements</h3>
            <p className="dialog-hint">
              Keep stable IDs when editing. Removed IDs cannot be reused.
            </p>
            {draft.requirements.map((item, index) => (
              <div className="spec-editor-item" key={index}>
                <label>
                  Requirement ID<input
                    required
                    pattern="FR-[0-9]+"
                    value={item.id}
                    onChange={(event) => {
                      usedIds.current.add(event.target.value);
                      setDraft((current) => ({
                        ...current,
                        requirements: current.requirements.map((
                          value,
                          position,
                        ) =>
                          position === index
                            ? { ...value, id: event.target.value }
                            : value
                        ),
                      }));
                    }}
                  />
                </label>
                <label>
                  Requirement<textarea
                    required
                    value={item.text}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        requirements: current.requirements.map((
                          value,
                          position,
                        ) =>
                          position === index
                            ? { ...value, text: event.target.value }
                            : value
                        ),
                      }))}
                  />
                </label>
                <label>
                  Needs clarification<input
                    value={item.clarify ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        requirements: current.requirements.map((
                          value,
                          position,
                        ) =>
                          position === index
                            ? { ...value, clarify: event.target.value }
                            : value
                        ),
                      }))}
                  />
                </label>
                <button
                  className="ghost"
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      requirements: current.requirements.filter((_, position) =>
                        position !== index
                      ),
                    }))}
                >
                  Remove {item.id}
                </button>
              </div>
            ))}
            <button
              className="button"
              type="button"
              onClick={() => {
                const id = nextID("FR");
                setDraft((current) => ({
                  ...current,
                  requirements: [...current.requirements, { id, text: "" }],
                }));
              }}
            >
              Add requirement
            </button>
          </section>
          <section>
            <h3>Success criteria</h3>
            {draft.success_criteria.map((item, index) => (
              <div className="spec-editor-item" key={index}>
                <label>
                  Criterion ID<input
                    required
                    pattern="SC-[0-9]+"
                    value={item.id}
                    onChange={(event) => {
                      usedIds.current.add(event.target.value);
                      setDraft((current) => ({
                        ...current,
                        success_criteria: current.success_criteria.map((
                          value,
                          position,
                        ) =>
                          position === index
                            ? { ...value, id: event.target.value }
                            : value
                        ),
                      }));
                    }}
                  />
                </label>
                <label>
                  Success criterion<textarea
                    required
                    value={item.text}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        success_criteria: current.success_criteria.map((
                          value,
                          position,
                        ) =>
                          position === index
                            ? { ...value, text: event.target.value }
                            : value
                        ),
                      }))}
                  />
                </label>
                <button
                  className="ghost"
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      success_criteria: current.success_criteria.filter((
                        _,
                        position,
                      ) =>
                        position !== index
                      ),
                    }))}
                >
                  Remove {item.id}
                </button>
              </div>
            ))}
            <button
              className="button"
              type="button"
              onClick={() => {
                const id = nextID("SC");
                setDraft((current) => ({
                  ...current,
                  success_criteria: [...current.success_criteria, {
                    id,
                    text: "",
                  }],
                }));
              }}
            >
              Add success criterion
            </button>
          </section>
          <p className="dialog-hint">
            User stories, scenarios, edge cases, entities and clarifications
            retain their current content. They can be maintained through the
            shared MCP or REST interface.
          </p>
          <label>
            Revision message<input
              maxLength={240}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
        </fieldset>
        {error && <RequestError message={error} />}
        {conflict && (
          <div className="spec-conflict" role="alert">
            <p>
              The server has a newer revision. Your draft is kept here. Review
              the latest content before retrying.
            </p>
            <button
              className="button"
              type="button"
              disabled={saving || reviewing}
              onClick={() => void reviewLatest()}
            >
              {reviewing ? "Loading latest…" : "Review latest revision"}
            </button>
          </div>
        )}
        {latest && (
          <section className="spec-conflict">
            <details>
              <summary>Server revision {latest.revision}</summary>
              <SpecDocument
                spec={specView(latest.content, latest.created_at)}
              />
            </details>
            <p>
              Reconcile the latest content with your draft. Saving applies your
              complete draft as the next revision.
            </p>
            <button
              className="button"
              type="button"
              disabled={saving || reviewing}
              onClick={() => {
                const previousBase = baseline.current;
                setDraft((current) =>
                  rebaseSpecDraft(previousBase, current, latest.content)
                );
                baseline.current = structuredClone(latest.content);
                setBaseRevision(latest.revision);
                setConflict(false);
                setError("");
                setLatest(null);
              }}
            >
              Use revision {latest.revision} as base, keep my draft
            </button>
          </section>
        )}
        {spec && (
          <p className="dialog-hint">Based on revision {baseRevision}.</p>
        )}
        <footer>
          <button
            className="button"
            type="button"
            disabled={saving || reviewing}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={saving || reviewing || conflict || (!spec && !team)}
          >
            {saving ? "Saving…" : spec ? "Save revision" : "Create spec"}
          </button>
        </footer>
      </form>
    </ModalDialog>
  );
}
