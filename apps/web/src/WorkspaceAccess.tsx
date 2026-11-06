import { Search, X, Copy, Check, ArrowDown, ArrowUp } from "lucide-react";
import { Fragment } from "react";
import { Dropdown } from "./Dropdown";
import { useEffect, useRef, useState } from "react";
import { api, apiPath, navigate, ModalDialog, RequestError, Workspace } from "./shared";
import { Session } from "./Session";

export type WorkspaceAccess = { enabled: boolean; role: string; subject: string };
type Member = {
  subject: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "suspended";
};

type MemberList = { members: Member[] };

export function initials(name: string) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toUpperCase();
}

export function MembersSettings() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [ascending, setAscending] = useState(true);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [access, setAccess] = useState<WorkspaceAccess | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const value = await api<WorkspaceAccess>(apiPath("/access"));
        if (!mounted.current) return;
        setAccess(value);
        if (value.enabled) {
          const result = await api<MemberList>(apiPath("/members"));
          if (mounted.current) setMembers(result.members);
        }
      } catch (cause) {
        if (mounted.current) setError((cause as Error).message);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  async function update(member: Member, change: Partial<Member>) {
    setBusy(true);
    setError("");
    setMessage("");
    const updated = { ...member, ...change };
    try {
      await api(apiPath("/members"), "PATCH", {
        subject: member.subject,
        role: updated.role,
        status: updated.status,
      });
      if (!mounted.current) return;
      if (member.subject === access!.subject) {
        window.location.reload();
        return;
      }
      setMembers((items) =>
        items.map((item) => (item.subject === member.subject ? updated : item)),
      );
      setMessage("Member updated.");
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function resetInvite() {
    setBusy(true);
    setInviteError("");
    setCopied(false);
    try {
      const result = await api<{ token: string }>(apiPath("/invite"), "POST");
      if (mounted.current)
        setInvite(`${window.location.origin}/auth/join?token=${encodeURIComponent(result.token)}`);
    } catch (cause) {
      if (mounted.current) setInviteError((cause as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
    } catch {
      setInviteError("Could not copy. Select and copy the link below.");
    }
  }

  const admin = access?.role === "admin";
  const search = query.trim().toLocaleLowerCase();
  const visible = members
    .filter(
      (member) =>
        (filter === "all" || member.status === filter) &&
        `${member.name} ${member.email}`.toLocaleLowerCase().includes(search),
    )
    .sort(
      (a, b) =>
        (a.name || a.email || a.subject).localeCompare(b.name || b.email || b.subject) *
        (ascending ? 1 : -1),
    );
  return (
    <section aria-label="Member directory">
      <div className="settings-directory-toolbar">
        <label className="settings-directory-search">
          <Search className="icon" />
          <input
            type="search"
            aria-label="Search members"
            placeholder="Search by name or email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Dropdown
          aria-label="Member status"
          value={filter}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "suspended", label: "Inactive" },
          ]}
          onChange={setFilter}
        />
        {admin && (
          <button
            className="button primary directory-primary-action"
            onClick={() => {
              setInviteError("");
              setInviting(true);
            }}
          >
            Invite
          </button>
        )}
      </div>
      {error && <RequestError message={error} />}
      <div className="settings-table-scroll">
        <table className="settings-directory-table">
          <thead>
            <tr>
              <th scope="col" aria-sort={ascending ? "ascending" : "descending"}>
                <button className="settings-sort" onClick={() => setAscending(!ascending)}>
                  Name{ascending ? <ArrowDown className="icon" /> : <ArrowUp className="icon" />}
                </button>
              </th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              {admin && (
                <th scope="col">
                  <span className="settings-sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {(["active", "suspended"] as const).map((status) => {
              const group = visible.filter((member) => member.status === status);
              return (
                group.length > 0 && (
                  <Fragment key={status}>
                    <tr className="settings-directory-group">
                      <th colSpan={admin ? 4 : 3} scope="rowgroup">
                        {status === "active" ? "Active" : "Inactive"}
                        <span>{group.length}</span>
                      </th>
                    </tr>
                    {group.map((member) => (
                      <tr
                        key={member.subject}
                        className={status === "suspended" ? "member-inactive" : ""}
                      >
                        <td>
                          <div className="settings-member-name">
                            <span className="settings-avatar" aria-hidden="true">
                              {initials(member.name || member.email)}
                            </span>
                            <strong>
                              {member.name || member.email || member.subject}
                              {member.subject === access?.subject && <small>you</small>}
                            </strong>
                          </div>
                        </td>
                        <td className="settings-member-email">
                          <span title={member.email}>{member.email || "—"}</span>
                        </td>
                        <td>
                          {admin ? (
                            <Dropdown
                              variant="ghost"
                              className={`settings-role role-${member.role}`}
                              aria-label={`Role for ${member.name || member.subject}`}
                              value={member.role}
                              disabled={busy}
                              onChange={(role) =>
                                void update(member, { role: role === "admin" ? "admin" : "member" })
                              }
                              options={[
                                { value: "member", label: "Member" },
                                { value: "admin", label: "Admin" },
                              ]}
                            />
                          ) : (
                            <span className={`settings-role role-${member.role}`}>
                              {member.role === "admin" ? "Admin" : "Member"}
                            </span>
                          )}
                        </td>
                        {admin && (
                          <td className="settings-member-action">
                            <button
                              className="button"
                              disabled={busy}
                              aria-label={`${status === "active" ? "Suspend" : "Restore"} ${member.name || member.email || member.subject}`}
                              onClick={() =>
                                void update(member, {
                                  status: status === "active" ? "suspended" : "active",
                                })
                              }
                            >
                              {status === "active" ? "Suspend" : "Restore"}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                )
              );
            })}
          </tbody>
        </table>
      </div>
      {loading ? (
        <p className="empty">Loading members…</p>
      ) : (
        !error &&
        visible.length === 0 && (
          <p className="empty">
            {access && !access.enabled
              ? "Member management is unavailable in this workspace."
              : query || filter !== "all"
                ? "No matching members"
                : "No members yet"}
          </p>
        )
      )}
      <p role="status" className="settings-directory-message">
        {message}
      </p>
      {inviting && (
        <ModalDialog
          className="issue-dialog settings-invite-dialog"
          aria-labelledby="invite-members-title"
          onClose={() => {
            if (!busy) setInviting(false);
          }}
          restoreFocus
        >
          <header>
            <h2 id="invite-members-title">Invite members</h2>
            <button
              className="ghost"
              aria-label="Close"
              disabled={busy}
              onClick={() => setInviting(false)}
            >
              <X className="icon" />
            </button>
          </header>
          <div className="settings-invite-content">
            <p>
              Anyone with this link can join as a Member. Creating a new link replaces all previous
              invitation links.
            </p>
            {invite && (
              <div className="settings-inline">
                <input
                  aria-label="Invitation link"
                  readOnly
                  value={invite}
                  onFocus={(event) => event.target.select()}
                />
                <button
                  className="button"
                  onClick={() => void copyInvite()}
                  aria-label={copied ? "Link copied" : "Copy invitation link"}
                >
                  {copied ? <Check className="icon" /> : <Copy className="icon" />}
                </button>
              </div>
            )}
            {inviteError && <RequestError message={inviteError} />}
            <div className="settings-invite-actions">
              <button className="button primary" disabled={busy} onClick={() => void resetInvite()}>
                {busy ? "Creating…" : invite ? "Replace invitation link" : "Create invitation link"}
              </button>
            </div>
          </div>
        </ModalDialog>
      )}
    </section>
  );
}

export function JoinWorkspace() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function join() {
    setBusy(true);
    setError("");
    try {
      const workspace = await api<Workspace>("/api/join", "POST", { token });
      window.history.replaceState(null, "", `/${workspace.slug}/`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="panel first-workspace">
      <h1>Join workspace</h1>
      <p>This invitation adds your account as a Member.</p>
      {!token && <p>This invitation is missing its link. Ask an administrator for a new one.</p>}
      {error && <RequestError message={error} />}
      <button className="button primary" disabled={busy || !token} onClick={() => void join()}>
        {busy ? "Joining…" : "Accept invitation"}
      </button>
      <button className="button" disabled={busy} onClick={() => navigate("/")}>
        Your workspaces
      </button>
      <Session />
    </main>
  );
}
