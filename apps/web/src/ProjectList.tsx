import { Box } from "lucide-react";
import { EntityEmoji } from "./EmojiPicker";
import { NavLink, pagePath, Project, Team } from "./shared";

// "2026-11-01" -> "Nov 1". Parsed by parts so the date never shifts with the local time zone.
function shortDate(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function ProjectList({
  projects,
  teams,
  loading,
  archived,
}: {
  projects: Project[];
  teams: Team[];
  loading: boolean;
  archived: boolean;
}) {
  if (loading) return <p className="empty">Loading projects…</p>;
  if (projects.length === 0)
    return (
      <div className="project-empty">
        <Box className="icon" aria-hidden="true" />
        <p>No {archived ? "archived" : "active"} projects</p>
        <small>
          {archived
            ? "Projects you archive will show up here."
            : "Projects group related issues across teams. Create one to get started."}
        </small>
      </div>
    );
  const teamName = (key: string) => teams.find((team) => team.key === key)?.name ?? key;
  return (
    <section className="project-list" aria-label="Project list">
      <div className="project-list-head" aria-hidden="true">
        <span>Name</span>
        <span>Teams</span>
        <span>Start date</span>
        <span>Target date</span>
      </div>
      {projects.map((project) => {
        const start = shortDate(project.start_date);
        const target = shortDate(project.target_date);
        return (
          <article key={project.id} className="project-row">
            <NavLink
              className="project-name"
              aria-label={project.name}
              to={pagePath(`/project/${project.id}`)}
            >
              <span className="project-icon">
                {project.emoji ? (
                  <EntityEmoji emoji={project.emoji} />
                ) : (
                  <Box className="icon" aria-hidden="true" />
                )}
              </span>
              <span className="project-text">
                <span className="project-title" title={project.name}>
                  {project.name}
                </span>
                {project.description && (
                  <span className="project-summary" title={project.description}>
                    {project.description}
                  </span>
                )}
              </span>
            </NavLink>
            <div
              className="project-teams-cell"
              title={
                project.teams.length === 0
                  ? "No teams assigned"
                  : project.teams.map(teamName).join(", ")
              }
            >
              {project.teams.length === 0 ? (
                <span className="project-none">No teams</span>
              ) : (
                project.teams.map((key) => (
                  <span key={key} className="project-team-pill">
                    {teamName(key)}
                  </span>
                ))
              )}
            </div>
            <span className={start ? "project-date" : "project-date project-none"}>
              {start || "—"}
            </span>
            <span className={target ? "project-date" : "project-date project-none"}>
              {target || "—"}
            </span>
          </article>
        );
      })}
    </section>
  );
}
