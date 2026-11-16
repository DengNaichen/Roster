import { useState } from "react";
import { EntityEmoji } from "./EmojiPicker";
import { PageHeader } from "./PageHeader";
import { ProjectDialog } from "./ProjectManagement";
import { ProjectList } from "./ProjectList";
import { ProjectTimeline } from "./ProjectTimeline";
import { apiPath, NavLink, pagePath, Project, RequestError, Team } from "./shared";
import { useResource } from "./useResource";

export default function ProjectsPage({
  team,
  teams,
  teamsLoading = false,
  onCreateTeam,
}: {
  team: string;
  teams: Team[];
  teamsLoading?: boolean;
  onCreateTeam?: () => void;
}) {
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Project | null>(null);
  const [timeline, setTimeline] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const projects = useResource<{ projects: Project[] }>(
    apiPath("/projects?include_archived=true"),
    { projects: [] },
  );
  const activeTeam = teams.find((item) => item.key === team);
  const visible = projects.data.projects.filter(
    (item) => item.archived === archived && (!team || item.teams.includes(team)),
  );
  const noTeams = !teamsLoading && teams.length === 0;
  return (
    <>
      <PageHeader
        actions={
          <button
            className="button primary"
            disabled={projects.loading || teamsLoading || !!projects.error || noTeams}
            onClick={() => setCreating(true)}
          >
            New project
          </button>
        }
      >
        {activeTeam && <EntityEmoji emoji={activeTeam.emoji} teamKey={activeTeam.key} />}
        <span>{team ? `${activeTeam?.name ?? team} / Projects` : "All projects"}</span>
      </PageHeader>
      <div className="project-toolbar">
        <div className="segmented" role="group" aria-label="Project status">
          <button type="button" aria-pressed={!archived} onClick={() => setArchived(false)}>
            Active
          </button>
          <button type="button" aria-pressed={archived} onClick={() => setArchived(true)}>
            Archived
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Project layout">
          <button type="button" aria-pressed={!timeline} onClick={() => setTimeline(false)}>
            List
          </button>
          <button type="button" aria-pressed={timeline} onClick={() => setTimeline(true)}>
            Timeline
          </button>
        </div>
      </div>
      {created && (
        <p className="scope-description" role="status">
          Created {created.name}.{" "}
          <NavLink to={pagePath(`/project/${created.id}`)}>View project</NavLink>
        </p>
      )}
      {projects.error ? (
        <div className="scope-message">
          <RequestError message={projects.error} />
          <button className="button" onClick={() => void projects.reload()}>
            Retry
          </button>
        </div>
      ) : noTeams && visible.length === 0 && !projects.loading ? (
        <div className="onboarding-empty" role="region" aria-label="Create a team first">
          <h2>Create a team before adding projects</h2>
          <p>
            Every project in Roster is assigned to at least one team so its issues have a team queue
            and numbering prefix.
          </p>
          {onCreateTeam && (
            <div className="onboarding-actions">
              <button type="button" className="button primary" onClick={onCreateTeam}>
                Create team
              </button>
            </div>
          )}
        </div>
      ) : timeline && !projects.loading ? (
        <ProjectTimeline projects={visible} onEdit={setEditing} />
      ) : (
        <ProjectList
          projects={visible}
          teams={teams}
          loading={projects.loading}
          archived={archived}
        />
      )}
      {editing && (
        <ProjectDialog
          project={editing}
          teams={teams}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            projects.update((data) => ({
              projects: data.projects.map((p) => (p.id === saved.id ? saved : p)),
            }));
            setEditing(null);
            await projects.reload();
          }}
        />
      )}
      {creating && (
        <ProjectDialog
          initialTeam={team}
          teams={teams}
          onClose={() => setCreating(false)}
          onSaved={async (saved) => {
            setCreated(saved);
            setArchived(false);
            await projects.reload();
            setCreating(false);
          }}
        />
      )}
    </>
  );
}
