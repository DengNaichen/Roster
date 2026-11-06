import { FormEvent, Fragment, useEffect, useRef, useState } from "react";
import { Dropdown } from "./Dropdown";
import { PageHeader } from "./PageHeader";
import { ChevronRight, Lock, Globe, Search, ArrowDown, ArrowUp } from "lucide-react";
import { PersonalSettings, WorkspaceSettings, IntegrationSettings } from "./SettingsSections";
import { EntityEmoji, EmojiPicker } from "./EmojiPicker";
import { TeamAccess } from "./TeamAccess";
import { MembersSettings } from "./WorkspaceAccess";
import { CycleSettingsSection } from "./CycleSettings";
import { api, apiPath, NavLink, pagePath, RequestError, Team } from "./shared";

type TeamDirectory = { teams: Team[] };

export function SettingsPage({
  section,
  settingsTeam,
  onCreateTeam,
  teams,
  loading,
  onSaved,
}: {
  section: "teams" | "members" | "personal" | "workspace" | "integrations";
  settingsTeam?: string;
  onCreateTeam: () => void;
  teams: Team[];
  loading: boolean;
  onSaved: (team: Team) => void;
}) {
  const [directory, setDirectory] = useState<Team[] | null>(null);
  const [directoryError, setDirectoryError] = useState("");
  useEffect(() => {
    if (section !== "teams") return;
    let active = true;
    api<TeamDirectory>(apiPath("/team-directory")).then(
      (result) => {
        if (active) setDirectory(result.teams);
      },
      (cause: Error) => {
        if (active) setDirectoryError(cause.message);
      },
    );
    return () => {
      active = false;
    };
  }, [section]);
  const entries = directory
    ? [...directory, ...teams.filter((team) => !directory.some((item) => item.key === team.key))]
    : teams;
  const current = entries.find((team) => team.key === settingsTeam);
  const [title, description] = {
    teams: ["Teams", "Teams group issues, cycles, and members."],
    members: ["Members", "People who can access this workspace."],
    personal: ["Personal", "Your profile and how Roster looks on this device."],
    workspace: ["Workspace", "The name and address everyone in this workspace sees."],
    integrations: ["Integrations", "Services connected to this workspace."],
  }[section];
  return (
    <>
      <PageHeader>
        <span className="settings-breadcrumb">Settings</span>
        <span>/</span>
        {settingsTeam ? (
          <>
            <NavLink to={pagePath("/settings/teams")}>Teams</NavLink>
            <span>/</span>
            <span>{current?.name ?? settingsTeam}</span>
          </>
        ) : (
          <span>{title}</span>
        )}
      </PageHeader>
      <div className="settings-page">
        <header className="settings-heading">
          <h1>
            {current ? (
              <>
                <EntityEmoji emoji={current.emoji} teamKey={current.key} /> {current.name}
              </>
            ) : (
              title
            )}
          </h1>
          <p>
            {current
              ? current.private
                ? "Private team. Only its members can see its issues."
                : "Everyone in the workspace can see this team."
              : description}
          </p>
        </header>
        {section === "personal" && <PersonalSettings />}
        {section === "workspace" && <WorkspaceSettings />}
        {section === "integrations" && <IntegrationSettings />}
        {section === "members" && <MembersSettings />}
        {section === "teams" && (
          <>
            {directoryError && <RequestError message={directoryError} />}
            {settingsTeam ? (
              current ? (
                <TeamSettings
                  key={current.key}
                  team={current}
                  onSaved={(updated) => {
                    setDirectory((items) =>
                      (items ?? teams).map((item) => (item.key === updated.key ? updated : item)),
                    );
                    onSaved(updated);
                  }}
                />
              ) : (
                <p className="empty">
                  {loading || (!directory && !directoryError) ? "Loading…" : "Team not found."}
                </p>
              )
            ) : (
              <TeamDirectory
                entries={entries}
                loading={loading || (!directory && !directoryError)}
                onCreateTeam={onCreateTeam}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

function TeamDirectory({
  entries,
  loading,
  onCreateTeam,
}: {
  entries: Team[];
  loading: boolean;
  onCreateTeam: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [ascending, setAscending] = useState(true);
  const visible = entries
    .filter(
      (team) =>
        `${team.name} ${team.key}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
        (filter === "all" || (filter === "private") === team.private),
    )
    .sort((a, b) => a.name.localeCompare(b.name) * (ascending ? 1 : -1));
  return (
    <>
      <div className="settings-directory-toolbar">
        <label className="settings-directory-search">
          <Search className="icon" />
          <input
            type="search"
            aria-label="Search teams"
            placeholder="Search teams"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Dropdown
          aria-label="Team visibility"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "public", label: "Workspace" },
            { value: "private", label: "Private" },
          ]}
        />
        <button className="button primary directory-primary-action" onClick={onCreateTeam}>
          Create team
        </button>
      </div>
      <div className="settings-table-scroll">
        <table className="settings-directory-table settings-teams-table">
          <thead>
            <tr>
              <th scope="col" aria-sort={ascending ? "ascending" : "descending"}>
                <button className="settings-sort" onClick={() => setAscending(!ascending)}>
                  Name{ascending ? <ArrowDown className="icon" /> : <ArrowUp className="icon" />}
                </button>
              </th>
              <th scope="col">Visibility</th>
              <th scope="col">
                <span className="settings-sr-only">Open team</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Your teams", true],
                ["Other teams", false],
              ] as const
            ).map(([label, joined]) => {
              const group = visible.filter((team) => Boolean(team.joined) === joined);
              return (
                group.length > 0 && (
                  <Fragment key={label}>
                    <tr className="settings-directory-group">
                      <th colSpan={3} scope="rowgroup">
                        {label}
                        <span>{group.length}</span>
                      </th>
                    </tr>
                    {group.map((team) => (
                      <tr key={team.key}>
                        <td>
                          <NavLink
                            className="settings-team-link"
                            to={pagePath(`/settings/teams/${encodeURIComponent(team.key)}`)}
                          >
                            <EntityEmoji emoji={team.emoji} teamKey={team.key} />
                            <strong>{team.name}</strong>
                            <span className="settings-team-key">{team.key}</span>
                          </NavLink>
                        </td>
                        <td>
                          <span className="settings-inline">
                            {team.private ? <Lock className="icon" /> : <Globe className="icon" />}
                            {team.private ? "Private" : "Workspace"}
                          </span>
                        </td>
                        <td>
                          <ChevronRight className="icon" aria-hidden="true" />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                )
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && (
        <p className="empty">
          {loading ? "Loading…" : query || filter !== "all" ? "No matching teams" : "No teams yet"}
        </p>
      )}
    </>
  );
}

function TeamSettings({ team, onSaved }: { team: Team; onSaved: (team: Team) => void }) {
  const [tab, setTab] = useState<"general" | "members" | "cycles">("general");
  const [draft, setDraft] = useState<{ name: string; emoji: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const value = draft ?? team;
  const dirty = value.name !== team.name || value.emoji !== team.emoji;

  function edit(change: Partial<{ name: string; emoji: string }>) {
    setDraft({ name: value.name, emoji: value.emoji, ...change });
    setSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const updated = await api<Team>(apiPath(`/teams/${encodeURIComponent(team.key)}`), "PATCH", {
        name: value.name,
        emoji: value.emoji,
      });
      if (!mounted.current) return;
      onSaved(updated);
      setDraft(null);
      setSaved(true);
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <section className="team-settings" aria-label={`${team.name} settings`}>
      <div className="segmented settings-tabs" role="tablist" aria-label="Team settings sections">
        {(["general", "members", "cycles"] as const)
          .filter((item) => item !== "members" || team.membership_enabled)
          .map((item) => (
            <button
              type="button"
              role="tab"
              key={item}
              aria-selected={tab === item}
              aria-pressed={tab === item}
              onClick={() => setTab(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
      </div>
      {tab === "general" && (
        <form className="settings-card" onSubmit={save}>
          <div className="settings-field">
            <div>
              <label htmlFor={`team-name-${team.key}`}>Name</label>
              <p>Shown in the sidebar and team menus.</p>
            </div>
            <div className="settings-name">
              <EmojiPicker
                value={value.emoji}
                teamKey={team.key}
                label={`Choose icon for ${team.name}`}
                onChange={(emoji) => edit({ emoji })}
                disabled={saving}
              />
              <input
                id={`team-name-${team.key}`}
                value={value.name}
                onChange={(event) => edit({ name: event.target.value })}
                required
                disabled={saving}
              />
            </div>
          </div>
          <div className="settings-field">
            <div>
              <span>Identifier</span>
              <p>Prefix for issue numbers. It can't be changed.</p>
            </div>
            <span className="settings-identifier" title="Cannot be changed">
              <Lock className="icon" /> {team.key}
            </span>
          </div>
          {error && <RequestError message={error} />}
          <footer>
            <span role="status">{saved ? "Changes saved." : dirty ? "Unsaved changes" : ""}</span>
            <button
              type="button"
              className="button"
              disabled={saving || !dirty}
              onClick={() => {
                setDraft(null);
                setError("");
                setSaved(false);
              }}
            >
              Reset
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={saving || !dirty || !value.name.trim()}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </footer>
        </form>
      )}
      {tab === "cycles" && (
        <CycleSettingsSection
          team={team.key}
          canManage={!team.membership_enabled || team.can_manage}
        />
      )}
      {tab === "members" && team.membership_enabled && (
        <TeamAccess team={team} onChanged={() => window.location.reload()} />
      )}
    </section>
  );
}

export default SettingsPage;
