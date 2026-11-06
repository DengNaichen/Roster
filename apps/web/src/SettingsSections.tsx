import githubMark from "./assets/github-invertocat.svg";
import { useState } from "react";
import { Lock, ArrowUpRight } from "lucide-react";
import { useSession } from "./integration";
import { type Appearance, readAppearance, saveAppearance } from "./appearance";
import { apiPath, RequestError, type Workspace, workspaceSlug } from "./shared";
import { useResource } from "./useResource";
import { WorkspaceDialog } from "./WorkspaceMenu";
import { initials, type WorkspaceAccess } from "./WorkspaceAccess";

export function PersonalSettings() {
  const { identity } = useSession();
  const [appearance, setAppearance] = useState(readAppearance);
  function change(next: Appearance) {
    setAppearance(next);
    saveAppearance(next);
  }
  return (
    <>
      {identity && (
        <section className="settings-section" aria-labelledby="settings-profile-title">
          <div className="settings-section-head">
            <h2 id="settings-profile-title">Profile</h2>
            <p>Shown on issues, comments, and work logs.</p>
          </div>
          <div className="settings-card">
            <div className="settings-field">
              <div className="settings-field-identity">
                <span className="settings-avatar" aria-hidden="true">
                  {initials(identity.name || identity.email)}
                </span>
                <div>
                  <strong>{identity.name}</strong>
                  <p>{identity.email}</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
      <section className="settings-section" aria-labelledby="settings-appearance-title">
        <div className="settings-section-head">
          <h2 id="settings-appearance-title">Appearance</h2>
          <p>Saved in this browser.</p>
        </div>
        <div className="settings-card">
          <div className="settings-field" role="radiogroup" aria-labelledby="settings-theme-label">
            <div>
              <span id="settings-theme-label">Theme</span>
              <p>Follow the system or choose one.</p>
            </div>
            <div className="settings-control settings-themes">
              {(
                [
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ] as const
              ).map(({ value, label }) => (
                <label className="settings-theme" key={value}>
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={appearance.theme === value}
                    onChange={() => change({ ...appearance, theme: value })}
                  />
                  <span className={`settings-theme-preview preview-${value}`} aria-hidden="true">
                    <i />
                    <span>
                      <b />
                      <b />
                      <b />
                    </span>
                  </span>
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div
            className="settings-field"
            role="radiogroup"
            aria-labelledby="settings-density-label"
          >
            <div>
              <span id="settings-density-label">Density</span>
              <p>Row height in lists.</p>
            </div>
            <div className="settings-control settings-segmented">
              {(["compact", "comfortable"] as const).map((density) => (
                <label key={density}>
                  <input
                    type="radio"
                    name="density"
                    checked={appearance.density === density}
                    onChange={() => change({ ...appearance, density })}
                  />
                  {density === "compact" ? "Compact" : "Comfortable"}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function WorkspaceSettings() {
  const workspaces = useResource<{ workspaces: Workspace[] }>("/api/workspaces", {
    workspaces: [],
  });
  const access = useResource<WorkspaceAccess>(apiPath("/access"), {
    enabled: true,
    role: "",
    subject: "",
  });
  const [editing, setEditing] = useState(false);
  const current = workspaces.data.workspaces.find((item) => item.slug === workspaceSlug());
  const canEdit =
    !access.loading && !access.error && (!access.data.enabled || access.data.role === "admin");
  return (
    <>
      {(workspaces.error || access.error) && (
        <RequestError message={workspaces.error || access.error} />
      )}
      {workspaces.loading ? (
        <p className="empty">Loading…</p>
      ) : current ? (
        <section className="settings-card" aria-label="Workspace details">
          <div className="settings-field">
            <div>
              <span>Name</span>
              <p>Shown in the workspace menu and on invitations.</p>
            </div>
            <div className="settings-control">
              <span>{current.name}</span>
              {canEdit && (
                <button
                  className="button"
                  aria-label="Rename workspace"
                  onClick={() => setEditing(true)}
                >
                  Rename
                </button>
              )}
            </div>
          </div>
          <div className="settings-field">
            <div>
              <span>URL</span>
              <p>The address in every link to this workspace. It can't be changed.</p>
            </div>
            <span className="settings-identifier" title="Cannot be changed">
              <Lock className="icon" />/{current.slug}
            </span>
          </div>
        </section>
      ) : (
        !workspaces.error && <p className="empty">Workspace not found.</p>
      )}
      {editing && current && (
        <WorkspaceDialog
          workspace={current}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            workspaces.update((data) => ({
              workspaces: data.workspaces.map((item) =>
                item.slug === updated.slug ? updated : item,
              ),
            }));
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

export function IntegrationSettings() {
  return (
    <section className="settings-card" aria-label="GitHub integration">
      <div className="settings-field">
        <div className="settings-field-identity">
          <img src={githubMark} width={28} height={28} alt="" className="settings-github-mark" />
          <div>
            <h2>GitHub</h2>
            <p>Pull requests and issue links. Managed outside Roster for now.</p>
          </div>
        </div>
        <button className="button" disabled>
          <ArrowUpRight className="icon" />
          Configure
        </button>
      </div>
    </section>
  );
}
