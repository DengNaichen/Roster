import { CalendarDays, Flag, Users, X } from "lucide-react";
import { MarkdownText } from "./MarkdownText";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api, apiPath, ModalDialog, Project, RequestError, Team } from "./shared";

export function ProjectDialog({ project, initialTeam, teams, onClose, onSaved }: { project?: Project; initialTeam?: string; teams: Team[]; onClose: () => void; onSaved: (project: Project) => Promise<void> }) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [startDate, setStartDate] = useState(project?.start_date ?? "");
  const [targetDate, setTargetDate] = useState(project?.target_date ?? "");
  const [selected, setSelected] = useState(project?.teams ?? (initialTeam ? [initialTeam] : []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const teamsChanged = project !== undefined && (selected.length !== project.teams.length || selected.some((key) => !project.teams.includes(key)));
  const needsTeams = !project || teamsChanged;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved = project
        ? await api<Project>(apiPath(`/projects/by-id/${project.id}`), "PATCH", { new_name: name, description, start_date: startDate, target_date: targetDate, ...(teamsChanged ? { teams: selected } : {}) })
        : await api<Project>(apiPath("/projects"), "POST", { name, description, teams: selected });
      if (mounted.current) await onSaved(saved);
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return <ModalDialog className="issue-dialog" aria-labelledby="project-dialog-title" restoreFocus onClose={() => { if (!saving) onClose(); }}>
    <form onSubmit={save}>
      <header><h2 id="project-dialog-title">{project ? "Edit project" : "New project"}</h2><button type="button" className="ghost" aria-label="Close" disabled={saving} onClick={onClose}><X className="icon" /></button></header>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required disabled={saving} /></label>
      <label>Description<textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} disabled={saving} /></label>
      {project && <div className="project-date-fields"><label>Start date<input type="date" value={startDate} max={targetDate || "9999-12-31"} min="0001-01-01" onChange={(event) => setStartDate(event.target.value)} disabled={saving} /></label><label>Target date<input type="date" value={targetDate} min={startDate || "0001-01-01"} max="9999-12-31" onChange={(event) => setTargetDate(event.target.value)} disabled={saving} /></label></div>}
      <fieldset className="project-teams" disabled={saving}><legend>Teams</legend>
        {teams.map((team) => <label key={team.key}><input type="checkbox" checked={selected.includes(team.key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, team.key] : current.filter((key) => key !== team.key))} />{team.name} ({team.key})</label>)}
      </fieldset>
      {teams.length === 0 && <p className="dialog-hint">Create a team before assigning this project.</p>}
      {selected.length === 0 && <p className="dialog-hint">{project && !teamsChanged ? "This historical project is unassigned. Select teams before adding issues; you can still edit its name and description." : "Select at least one team."}</p>}
      {error && <RequestError message={error} />}
      <footer><button type="button" className="button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving || (needsTeams && selected.length === 0)}>{saving ? "Saving…" : project ? "Save project" : "Create project"}</button></footer>
    </form>
  </ModalDialog>;
}

export function ProjectOverview({ project, teams, onEdit, onSaved }: { project: Project; teams: Team[]; onEdit: () => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function changeArchive() {
    setSaving(true);
    setError("");
    try {
      await api<Project>(apiPath(`/projects/by-id/${project.id}`), "PATCH", { archived: !project.archived });
      if (mounted.current) await onSaved();
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  const teamName = (key: string) => teams.find((team) => team.key === key)?.name ?? key;
  return <section className="project-overview" aria-label="Project details">
    <h1>{project.name}</h1>
    <div className="project-properties" aria-label="Properties">
      <span className="project-properties-label">Properties</span>
      <span className="property-chip"><CalendarDays className="icon" aria-hidden="true" />{project.start_date ? `Start ${project.start_date}` : "No start date"}</span>
      <span className="property-chip"><Flag className="icon" aria-hidden="true" />{project.target_date ? `Target ${project.target_date}` : "No target date"}</span>
      {project.teams.length === 0
        ? <span className="property-chip property-chip-muted"><Users className="icon" aria-hidden="true" />No teams</span>
        : project.teams.map((key) => <span key={key} className="property-chip"><Users className="icon" aria-hidden="true" />{teamName(key)}</span>)}
    </div>
    {project.archived && <p className="project-notice">Archived project. Existing issues remain available. Restore it before adding new issues.</p>}
    {project.teams.length === 0 && !project.archived && <p className="project-notice">This historical project has no assigned teams yet. Assign teams to add issues.</p>}
    <div className="project-section">
      <h2>Description</h2>
      {project.description ? <MarkdownText text={project.description} /> : <p className="project-none">No description yet.</p>}
    </div>
    <div className="project-actions"><button type="button" className="button" disabled={saving} onClick={onEdit}>{project.teams.length === 0 ? "Assign teams / Edit project" : "Edit project"}</button><button type="button" className="button" disabled={saving} onClick={() => void changeArchive()}>{saving ? "Saving…" : project.archived ? "Restore project" : "Archive project"}</button></div>
    {error && <RequestError message={error} />}
  </section>;
}
