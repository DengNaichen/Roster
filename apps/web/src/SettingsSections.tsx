import githubMark from "./assets/github-invertocat.svg";
import { useState } from "react";
import { Sun, Moon, Monitor, Check, Pencil, Lock, ArrowUpRight } from "lucide-react";
import { useSession } from "./integration";
import { type Appearance, readAppearance, saveAppearance } from "./appearance";
import { apiPath, RequestError, type Workspace, workspaceSlug } from "./shared";
import { useResource } from "./useResource";
import { WorkspaceDialog } from "./WorkspaceMenu";
import type { WorkspaceAccess } from "./WorkspaceAccess";

export function PersonalSettings() {
  const { identity } = useSession();
  const [appearance, setAppearance] = useState(readAppearance);
  function change(next: Appearance) {
    setAppearance(next);
    saveAppearance(next);
  }
  return (
    <div className="settings-sections">
      {identity && (
        <section className="settings-profile">
          <span className="settings-profile-avatar">
            {(identity.name || identity.email).slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{identity.name}</strong>
            <p>{identity.email}</p>
          </div>
        </section>
      )}
      <fieldset className="settings-choice-group">
        <legend>Appearance</legend>
        <div className="settings-choices">
          {(
            [
              { value: "light", label: "Light", Icon: Sun },
              { value: "dark", label: "Dark", Icon: Moon },
              { value: "system", label: "System", Icon: Monitor },
            ] as const
          ).map(({ value, label, Icon }) => (
            <label className="settings-choice" key={value}>
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
              <span className="settings-choice-caption">
                <Icon className="icon" />
                {label}
                {appearance.theme === value && <Check className="icon choice-check" />}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="settings-choice-group">
        <legend>Density</legend>
        <div className="settings-choices">
          {(["compact", "comfortable"] as const).map((density) => (
            <label className="settings-choice" key={density}>
              <input
                type="radio"
                name="density"
                checked={appearance.density === density}
                onChange={() => change({ ...appearance, density })}
              />
              <span className={`settings-density-preview density-${density}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="settings-choice-caption">
                {density === "compact" ? "Compact" : "Comfortable"}
                {appearance.density === density && <Check className="icon choice-check" />}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
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
        <section className="settings-general">
          <div className="settings-field">
            <span>Name</span>
            <div className="settings-inline">
              <strong>{current.name}</strong>
              {canEdit && (
                <button
                  className="ghost"
                  aria-label="Rename workspace"
                  title="Rename workspace"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="icon" />
                </button>
              )}
            </div>
          </div>
          <div className="settings-field">
            <span>URL</span>
            <span className="settings-inline" title="Cannot be changed">
              <span>/{current.slug}</span>
              <Lock className="icon" />
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
    <section className="settings-integration-card" aria-label="GitHub integration">
      <div className="settings-integration-header">
        <img src={githubMark} width={28} height={28} alt="" className="settings-github-mark" />
        <div>
          <h2>GitHub</h2>
          <p>Pull requests · Issue links</p>
        </div>
        <span className="settings-integration-status">Managed externally</span>
      </div>
      <div className="settings-integration-footer">
        <span>Connection settings aren’t available here yet.</span>
        <button className="button" disabled>
          <ArrowUpRight className="icon" />
          Configure
        </button>
      </div>
    </section>
  );
}
