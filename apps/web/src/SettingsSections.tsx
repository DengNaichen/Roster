import githubMark from "./assets/github-invertocat.svg";
import { useEffect, useState } from "react";
import { Lock, ArrowUpRight, Copy, Check } from "lucide-react";
import { Dropdown } from "./Dropdown";
import { mcpServerUrl, useSession } from "./integration";
import { type Appearance, readAppearance, saveAppearance } from "./appearance";
import {
  buildAgentVerificationPrompt,
  buildMcpClientSnippet,
  type McpClientKind,
  mcpServerName,
} from "./mcpSetup";
import {
  apiPath,
  NavLink,
  pagePath,
  RequestError,
  type Team,
  type Workspace,
  workspaceSlug,
} from "./shared";
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

export function IntegrationSettings({
  teams = [],
  loading = false,
  onCreateTeam,
}: {
  teams?: Team[];
  loading?: boolean;
  onCreateTeam?: () => void;
}) {
  const slug = workspaceSlug();
  const { preview } = useSession();
  const accessibleTeams = teams.filter((team) => team.accessible !== false);
  const requestedTeam = new URLSearchParams(window.location.search).get("team") ?? "";
  const [selectedTeamKey, setSelectedTeamKey] = useState(
    () =>
      accessibleTeams.find((team) => team.key === requestedTeam)?.key ??
      accessibleTeams[0]?.key ??
      "",
  );
  const [client, setClient] = useState<McpClientKind>("codex");
  const [copiedField, setCopiedField] = useState<"" | "url" | "config" | "login" | "prompt">("");
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    if (selectedTeamKey && accessibleTeams.some((team) => team.key === selectedTeamKey)) return;
    const matched =
      accessibleTeams.find((team) => team.key === requestedTeam)?.key ??
      accessibleTeams[0]?.key ??
      "";
    if (matched !== selectedTeamKey) setSelectedTeamKey(matched);
  }, [accessibleTeams, requestedTeam, selectedTeamKey]);

  const selectedTeam = accessibleTeams.find((team) => team.key === selectedTeamKey) ?? null;
  const endpoint = mcpServerUrl(slug);
  const serverName = mcpServerName(slug);
  const snippet = buildMcpClientSnippet(client, slug, endpoint, preview);
  const prompt = buildAgentVerificationPrompt({ slug, team: selectedTeam });

  async function copyText(kind: "url" | "config" | "login" | "prompt", value: string) {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(kind);
    } catch {
      setCopiedField("");
      setCopyError("Clipboard access was blocked. Select and copy the text directly.");
    }
  }

  return (
    <>
      <section className="settings-section" aria-labelledby="settings-mcp-title">
        <div className="settings-section-head">
          <h2 id="settings-mcp-title">Coding agents (MCP)</h2>
          <p>
            Connect Codex, Claude Code, Cursor, or another MCP client from any repository to read
            and create issues in <code>/{slug}</code>.
          </p>
        </div>
        <div className="settings-card">
          <div className="settings-field settings-mcp-row">
            <div>
              <label htmlFor="workspace-mcp-url">MCP server URL</label>
              <p>
                {preview
                  ? "Local preview uses the workspace in this URL."
                  : "Choose the workspace and read-only or read-write access when you authorize."}{" "}
                Use <code>{serverName}</code> for a separate client authentication context.
              </p>
            </div>
            <div className="settings-copy-group">
              <input
                id="workspace-mcp-url"
                className="settings-code-input"
                readOnly
                value={endpoint}
                onFocus={(event) => event.target.select()}
              />
              <button
                type="button"
                className="button"
                onClick={() => void copyText("url", endpoint)}
              >
                {copiedField === "url" ? <Check className="icon" /> : <Copy className="icon" />}
                {copiedField === "url" ? "Copied URL" : "Copy URL"}
              </button>
            </div>
          </div>

          <div className="settings-field">
            <div>
              <span>Target team</span>
              <p>
                {selectedTeam
                  ? selectedTeam.private
                    ? `Private team (${selectedTeam.key}). Make sure your authorized account is a member.`
                    : `Verification prompt below targets ${selectedTeam.name} (${selectedTeam.key}).`
                  : loading
                    ? "Loading teams…"
                    : "Create a team so your agent has an issue queue to read and write."}
              </p>
            </div>
            <div className="settings-control">
              {accessibleTeams.length > 0 ? (
                <Dropdown
                  aria-label="Target team"
                  value={selectedTeam?.key ?? ""}
                  onChange={setSelectedTeamKey}
                  options={accessibleTeams.map((team) => ({
                    value: team.key,
                    label: `${team.name} (${team.key})`,
                  }))}
                />
              ) : onCreateTeam ? (
                <button type="button" className="button primary" onClick={onCreateTeam}>
                  Create team
                </button>
              ) : null}
            </div>
          </div>

          <div className="settings-mcp-block">
            <div className="settings-mcp-block-head">
              <div>
                <span id="mcp-client-label">1. Add MCP server in your other repository</span>
                <p>{snippet.hint}</p>
              </div>
              <div
                className="settings-control settings-segmented"
                role="radiogroup"
                aria-labelledby="mcp-client-label"
              >
                {(
                  [
                    { value: "codex", label: "Codex" },
                    { value: "claude", label: "Claude Code" },
                    { value: "json", label: "JSON / Cursor" },
                  ] as const
                ).map((item) => (
                  <label key={item.value}>
                    <input
                      type="radio"
                      name="mcp-client"
                      checked={client === item.value}
                      onChange={() => {
                        setClient(item.value);
                        setCopiedField("");
                      }}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="settings-code-panel">
              <pre>
                <code>{snippet.code}</code>
              </pre>
              <button
                type="button"
                className="button"
                onClick={() => void copyText("config", snippet.code)}
              >
                {copiedField === "config" ? <Check className="icon" /> : <Copy className="icon" />}
                {copiedField === "config" ? "Copied config" : "Copy config"}
              </button>
            </div>
            {snippet.authCommand && (
              <div className="settings-auth-command">
                <span>Then authorize once in your browser:</span>
                <code>{snippet.authCommand}</code>
                <button
                  type="button"
                  className="button"
                  onClick={() => void copyText("login", snippet.authCommand!)}
                >
                  {copiedField === "login" ? <Check className="icon" /> : <Copy className="icon" />}
                  {copiedField === "login" ? "Copied command" : "Copy login"}
                </button>
              </div>
            )}
          </div>

          <div className="settings-mcp-block">
            <div className="settings-mcp-block-head">
              <div>
                <span>2. Verify team access &amp; read or create your first issue</span>
                <p>
                  Paste this prompt into your coding agent to confirm it sees{" "}
                  {selectedTeam ? (
                    <>
                      team <code>{selectedTeam.key}</code> in <code>{slug}</code>
                    </>
                  ) : (
                    <>
                      workspace <code>{slug}</code>
                    </>
                  )}{" "}
                  before starting real work.
                </p>
              </div>
              <button
                type="button"
                className="button primary"
                onClick={() => void copyText("prompt", prompt)}
              >
                {copiedField === "prompt" ? <Check className="icon" /> : <Copy className="icon" />}
                {copiedField === "prompt" ? "Copied prompt" : "Copy prompt"}
              </button>
            </div>
            <div className="settings-code-panel">
              <pre aria-label="Agent verification prompt">
                <code>{prompt}</code>
              </pre>
            </div>
          </div>

          {copyError && <RequestError message={copyError} />}

          <div className="settings-mcp-guide">
            <h3>Authentication &amp; troubleshooting</h3>
            <ul>
              <li>
                <strong>Browser sign-in vs. Agent OAuth vs. GitHub sync:</strong> Signing in with
                Google or GitHub only identifies you in this web app (<code>user:email</code>).
                Coding agents authenticate separately via OAuth 2.1 on <code>/oauth/consent</code>{" "}
                with your Roster permissions—never put tokens or database keys in repo files.
              </li>
              <li>
                <strong>401 Unauthenticated:</strong> Run{" "}
                <code>{snippet.authCommand ?? `codex mcp login ${serverName}`}</code> and approve
                access on <code>/oauth/consent</code>, or re-run it if your token expired.
              </li>
              <li>
                <strong>403 Forbidden or missing team in list_teams:</strong> Verify the Roster
                account you authorized is an active member of <code>/{slug}</code>, and join private
                teams in <NavLink to={pagePath("/settings/teams")}>Settings → Teams</NavLink>.
              </li>
              <li>
                <strong>404 Not Found, tools not loaded, or wrong workspace:</strong> Confirm the
                connection’s <code>whoami</code> result names <code>{slug}</code>. Reauthorize if it
                differs. Use server name <code>{serverName}</code> so another workspace’s global
                server doesn’t shadow it, and in Codex either run <code>codex mcp add</code> or
                trust the target repository so its <code>.codex/config.toml</code> is loaded.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-github-section">
        <div className="settings-section-head">
          <h2 id="settings-github-section">Repository sync</h2>
          <p>Optional server-side webhook integration. Not required for MCP coding agents.</p>
        </div>
        <div className="settings-card" aria-label="GitHub integration">
          <div className="settings-field">
            <div className="settings-field-identity">
              <img
                src={githubMark}
                width={28}
                height={28}
                alt=""
                className="settings-github-mark"
              />
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
        </div>
      </section>
    </>
  );
}
