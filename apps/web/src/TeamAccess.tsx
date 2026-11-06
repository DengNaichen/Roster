import { Dropdown } from "./Dropdown";
import { useEffect, useRef, useState } from "react";
import { api, apiPath, NavLink, pagePath, RequestError, Team } from "./shared";
import { initials } from "./WorkspaceAccess";

type Member = {
  workspace_admin: boolean;
  subject: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

type MemberDirectory = { members: Member[] };

export function TeamAccess({ team, onChanged }: { team: Team; onChanged: () => void }) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [members, setMembers] = useState<Member[]>([]);
  const [candidates, setCandidates] = useState<Member[]>([]);
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmJoin, setConfirmJoin] = useState(false);
  const [version, setVersion] = useState(0);
  const path = `/teams/${encodeURIComponent(team.key)}`;
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await api<MemberDirectory>(apiPath(path + "/members"));
        if (active) setMembers(result.members);
        if (team.can_manage) {
          const workspace = await api<MemberDirectory>(apiPath("/members"));
          if (active)
            setCandidates(
              workspace.members.filter(
                (item) =>
                  item.status === "active" &&
                  !result.members.some((member) => member.subject === item.subject),
              ),
            );
        }
      } catch (cause) {
        if (active) setError((cause as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [path, team.can_manage, version]);

  async function save(suffix: string, method: string, input: object) {
    setBusy(true);
    setError("");
    try {
      await api(apiPath(path + suffix), method, input);
      if (!mounted.current) return;
      setSubject("");
      setConfirmJoin(false);
      setVersion((value) => value + 1);
      onChanged();
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="team-access">
      <section className="settings-section" aria-labelledby={`team-access-${team.key}`}>
        <div className="settings-section-head">
          <h2 id={`team-access-${team.key}`}>Access</h2>
        </div>
        <div className="settings-card">
          <div className="settings-field">
            <div>
              <span>{team.private ? "Private team" : "Public team"}</span>
              <p>
                {team.private
                  ? "Only team members can see its issues and projects."
                  : "Everyone in the workspace can see its issues."}
              </p>
            </div>
            {team.can_manage && (
              <button
                className="button"
                disabled={busy}
                onClick={() => void save("", "PATCH", { private: !team.private })}
              >
                {team.private ? "Make public" : "Make private"}
              </button>
            )}
          </div>
          <div className="settings-field">
            <div>
              <span>Your membership</span>
              <p>
                {team.private
                  ? "Leaving requires an owner to add you again."
                  : "Members can collaborate without joining. Join to keep this team in your sidebar."}
              </p>
            </div>
            <div className="settings-control">
              {team.accessible && (
                <NavLink to={pagePath(`/team/${encodeURIComponent(team.key)}/issues`)}>
                  View issues
                </NavLink>
              )}
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  if (team.private && !team.joined) setConfirmJoin(true);
                  else void save("/membership", "POST", { leave: team.joined });
                }}
              >
                {team.joined ? "Leave team" : "Join team"}
              </button>
            </div>
          </div>
          {confirmJoin && (
            <div className="team-join-confirm" role="alert">
              <p>Joining this private team gives you access to its private issues and projects.</p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void save("/membership", "POST", { confirm_private: true })}
              >
                Confirm private access
              </button>
              <button className="button" disabled={busy} onClick={() => setConfirmJoin(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="settings-section" aria-labelledby={`team-members-${team.key}`}>
        <div className="settings-section-head">
          <h2 id={`team-members-${team.key}`}>Team members</h2>
        </div>
        <div className="settings-card">
          {members.length === 0 && <p className="settings-list-empty">No team members.</p>}
          {members.map((member) => (
            <div className="settings-field" key={member.subject}>
              <div className="settings-field-identity">
                <span className="settings-avatar" aria-hidden="true">
                  {initials(member.name || member.email)}
                </span>
                <div>
                  <strong>{member.name || member.email || member.subject}</strong>
                  <p>{member.status === "suspended" ? "Suspended" : member.email}</p>
                </div>
              </div>
              <div className="settings-control">
                <span>
                  {member.workspace_admin
                    ? "Workspace admin"
                    : member.role === "owner"
                      ? "Team owner"
                      : "Member"}
                </span>
                {team.can_manage && (
                  <>
                    <button
                      className="button"
                      disabled={busy || member.workspace_admin || member.status !== "active"}
                      onClick={() =>
                        void save("/members", "PATCH", {
                          subject: member.subject,
                          role: member.role === "owner" ? "member" : "owner",
                        })
                      }
                    >
                      {member.role === "owner" ? "Make member" : "Make owner"}
                    </button>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void save("/members", "PATCH", { subject: member.subject, remove: true })
                      }
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {team.can_manage && (
            <form
              className="settings-field team-member-add"
              onSubmit={(event) => {
                event.preventDefault();
                void save("/members", "PATCH", { subject, role: "member" });
              }}
            >
              <div>
                <span>Add workspace member</span>
                <p>Only active workspace members who aren't on this team are listed.</p>
              </div>
              <div className="settings-control">
                <Dropdown
                  variant="block"
                  aria-label="Add workspace member"
                  placeholder="Choose a member"
                  required
                  disabled={busy}
                  value={subject}
                  onChange={setSubject}
                  options={candidates.map((candidate) => ({
                    value: candidate.subject,
                    label: candidate.name || candidate.email || candidate.subject,
                  }))}
                />
                <button className="button" disabled={busy || !subject}>
                  Add
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
      {error && <RequestError message={error} />}
    </div>
  );
}
