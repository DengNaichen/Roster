import { Dropdown } from "./Dropdown";
import { UnavailableField, useCapabilities } from "./Capabilities";
import { CycleSelect } from "./Cycles";
import { AssigneeSelect } from "./Assignee";
import { Box, Users, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { EmojiPicker } from "./EmojiPicker";
import { deriveTeamKey } from "./onboarding";
import { SummaryField } from "./SummaryField";
import {
  RequestError,
  api,
  apiPath,
  columns,
  Issue,
  ModalDialog,
  Priority,
  PrioritySelect,
  Project,
  Status,
  StatusIcon,
  Team,
} from "./shared";

export function NewIssueDialog({
  cycleID: initialCycleID = 0,
  teams,
  team: scopeTeam,
  status,
  project: initialProject,
  projects,
  onClose,
  onCreate,
}: {
  cycleID?: number;
  teams: Team[];
  team: string;
  status: Status;
  project: Project | null;
  projects: Project[];
  onClose: () => void;
  onCreate: (issue: Issue) => Promise<void>;
}) {
  const capabilities = useCapabilities();
  const [team, setTeam] = useState(
    initialProject ? (initialProject.teams.length === 1 ? initialProject.teams[0] : "") : scopeTeam,
  );
  const [projectID, setProjectID] = useState(initialProject?.id ?? 0);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [priority, setPriority] = useState<Priority>(0);
  const [issueStatus, setIssueStatus] = useState<Status>(status);
  const [cycleID, setCycleID] = useState(initialCycleID);
  const [assignee, setAssignee] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectedProject = projects.find((item) => item.id === projectID);
  const incompatible =
    projectID !== 0 &&
    !!team &&
    (!selectedProject || selectedProject.archived || !selectedProject.teams.includes(team));

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api<Issue>(apiPath("/issues"), "POST", {
        team,
        title,
        ...(summary.trim() && { document: { lead: summary, sections: [], criteria: [] } }),
        status: issueStatus,
        project_id: projectID,
        priority,
        assignee,
        cycle_id: cycleID,
      });
      if (mounted.current) await onCreate(created);
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <ModalDialog
      className="issue-dialog issue-composer"
      aria-labelledby="new-issue-title"
      restoreFocus
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form onSubmit={create}>
        <header>
          <h2 id="new-issue-title">New issue</h2>
          <button
            type="button"
            className="ghost"
            aria-label="Close"
            disabled={saving}
            onClick={onClose}
          >
            <X className="icon" />
          </button>
        </header>
        <label className="composer-title">
          <span className="composer-field-label">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Issue title"
            required
            disabled={saving}
          />
        </label>
        <SummaryField value={summary} onChange={setSummary} disabled={saving} />
        <div className="composer-properties">
          {teams.length > 0 ? (
            <label className="composer-property">
              <Users className="icon" />
              <span className="composer-property-name">
                Team <span title="Required">*</span>
              </span>
              <Dropdown
                variant="ghost"
                value={team}
                aria-label="Team"
                placeholder="Choose a team…"
                required
                disabled={saving}
                onChange={(next) => {
                  setTeam(next);
                  setAssignee("");
                  setCycleID(0);
                }}
                options={teams.map((item) => ({
                  value: item.key,
                  label: `${item.name} (${item.key})`,
                }))}
              />
            </label>
          ) : (
            <p className="error" role="alert">
              No teams yet. Create a team from Navigation, then reopen this dialog.
            </p>
          )}
          <label className="composer-property">
            <span className="composer-property-name">Assignee</span>
            <AssigneeSelect
              key={team}
              team={team}
              value={assignee}
              onChange={setAssignee}
              disabled={saving}
              label="New issue assignee"
            />
          </label>
          <label className="composer-property">
            <span className="composer-property-name">Cycle</span>
            {!capabilities.cycles ? (
              <UnavailableField name="Cycle" />
            ) : (
              <CycleSelect
                key={team}
                team={team}
                value={cycleID}
                disabled={saving}
                onChange={(id) => setCycleID(Number(id))}
                label="New issue cycle"
              />
            )}
          </label>
          <IssueProjectSelect
            projects={projects}
            team={team}
            value={projectID}
            onChange={setProjectID}
            disabled={saving || !team || !capabilities.projects}
            fallback={initialProject?.name ?? "Unavailable project"}
          />
          {!capabilities.projects && <UnavailableField name="Project" />}
          <div className="composer-property composer-priority">
            <span className="composer-property-name">Priority</span>
            <PrioritySelect
              priority={priority}
              onChange={setPriority}
              label="New issue priority"
              disabled={saving}
            />
          </div>
          <label className="composer-property composer-status">
            <StatusIcon status={issueStatus} />
            <Dropdown
              variant="ghost"
              aria-label="Status"
              value={issueStatus}
              disabled={saving}
              onChange={(next) => setIssueStatus(next as Status)}
              options={columns.map((column) => ({
                value: column.status,
                label: column.label,
              }))}
            />
          </label>
        </div>
        {!team && (
          <p className="dialog-hint">
            Choose the team responsible for this issue before selecting a project.
          </p>
        )}
        {incompatible && (
          <p className="error" role="alert">
            This project is not available for the selected team. Clear it or choose another project.
          </p>
        )}
        {error && <RequestError message={error} />}
        <footer>
          <button type="button" className="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={saving || !team || incompatible}
          >
            {saving ? "Creating…" : "Create issue"}
          </button>
        </footer>
      </form>
    </ModalDialog>
  );
}

export function IssueProjectSelect({
  projects,
  team,
  value,
  onChange,
  disabled,
  retainedID = 0,
  fallback,
}: {
  projects: Project[];
  team: string;
  value: number;
  onChange: (id: number) => void;
  disabled: boolean;
  retainedID?: number;
  fallback: string;
}) {
  const available = projects.filter(
    (project) => project.teams.includes(team) && (!project.archived || project.id === retainedID),
  );
  const unavailable = value !== 0 && !available.some((project) => project.id === value);
  return (
    <label className="composer-property">
      <Box className="icon" />
      <span className="composer-property-name">Project</span>
      <Dropdown
        variant="ghost"
        aria-label="Project"
        value={String(value)}
        disabled={disabled}
        onChange={(next) => onChange(Number(next))}
        options={[
          { value: "0", label: "No project" },
          ...(unavailable
            ? [
                {
                  value: String(value),
                  label: `${projects.find((project) => project.id === value)?.name ?? fallback}${team ? " (not available for this team)" : " (choose a team)"}`,
                  disabled: true,
                },
              ]
            : []),
          ...available.map((project) => ({
            value: String(project.id),
            label: `${project.name}${project.archived ? " (archived, current project)" : ""}`,
          })),
        ]}
      />
    </label>
  );
}

export function CreateTeamDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (team: Team) => void;
}) {
  const [privateTeam, setPrivateTeam] = useState(false);
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [startNumber, setStartNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function changeName(next: string) {
    setName(next);
    if (!keyEdited) {
      setKey(deriveTeamKey(next));
    }
  }

  function changeKey(raw: string) {
    const cleaned = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    setKey(cleaned);
    setKeyEdited(cleaned.length > 0);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api<Team>(apiPath("/teams"), "POST", {
        key,
        name,
        emoji,
        private: privateTeam,
        start_number: startNumber ? Number(startNumber) : undefined,
      });
      if (mounted.current) onCreate(created);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const previewKey = key || "ENG";

  return (
    <ModalDialog
      className="issue-dialog"
      aria-labelledby="new-team-title"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form onSubmit={create}>
        <header>
          <h2 id="new-team-title">Create team</h2>
          <button
            type="button"
            className="ghost"
            aria-label="Close"
            disabled={saving}
            onClick={onClose}
          >
            <X className="icon" />
          </button>
        </header>
        <p className="dialog-hint">
          Teams own issue queues, specs, and cycles (for example, per product or repository).
          Projects can later group related issues across one or more teams.
        </p>
        <label>
          Name
          <input
            disabled={saving}
            value={name}
            onChange={(event) => changeName(event.target.value)}
            placeholder="Engineering or repository name"
            required
          />
        </label>
        <div className="dialog-team-identity">
          <label>
            Identifier (Key)
            <input
              disabled={saving}
              value={key}
              onChange={(event) => changeKey(event.target.value)}
              placeholder="ENG"
              pattern="[A-Z][A-Z0-9]{1,5}"
              maxLength={6}
              required
            />
          </label>
          <div className="dialog-emoji-field">
            <span>Icon</span>
            <EmojiPicker
              value={emoji}
              teamKey={previewKey}
              label="New team emoji"
              onChange={setEmoji}
              disabled={saving}
            />
          </div>
        </div>
        <p className="dialog-hint">
          Issues are numbered{" "}
          <code>
            {previewKey}-{startNumber || "1"}
          </code>
          ,{" "}
          <code>
            {previewKey}-{startNumber ? Number(startNumber) + 1 : "2"}
          </code>
          , and so on. Use 2–6 uppercase letters or digits starting with a letter; the key cannot be
          changed later.
        </p>
        <div className="dialog-checkbox-group">
          <label className="dialog-checkbox">
            <input
              type="checkbox"
              checked={privateTeam}
              onChange={(event) => setPrivateTeam(event.target.checked)}
              disabled={saving}
            />
            <span>Make team private</span>
          </label>
          <p className="dialog-hint">
            Only invited team members—and coding agents authorized by them—can view or create issues
            in a private team.
          </p>
        </div>
        <details className="dialog-disclosure">
          <summary>Import options (custom starting issue number)</summary>
          <label>
            Start number
            <input
              disabled={saving}
              type="number"
              min={1}
              step={1}
              value={startNumber}
              onChange={(event) => setStartNumber(event.target.value)}
              placeholder="1"
            />
          </label>
          <p className="dialog-hint">
            Set above numbers already used in another tracker before importing historical issues.
          </p>
        </details>
        {error && <RequestError message={error} />}
        <footer>
          <button type="button" className="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? "Creating…" : "Create team"}
          </button>
        </footer>
      </form>
    </ModalDialog>
  );
}
