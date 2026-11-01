import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Member,
  Team,
  TeamMember,
  Workspace,
} from "../../../../packages/contracts/mod";
import { api } from "../api";
import { ErrorText, Form } from "../components";
export function Settings() {
  const { slug } = useParams();
  const qc = useQueryClient();
  const base = `/w/${slug}`;
  const access = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<{ workspaces: Workspace[] }>("/workspaces"),
  });
  const admin =
    access.data?.workspaces.find((w) => w.slug === slug)?.role === "admin";
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<unknown>();
  const members = useQuery({
    enabled: admin,
    queryKey: [slug, "members"],
    queryFn: () => api<{ members: Member[] }>(base + "/members"),
  });
  const teams = useQuery({
    queryKey: [slug, "directory"],
    queryFn: () => api<{ teams: Team[] }>(base + "/team-directory"),
  });
  async function write(path: string, body: unknown, method = "PATCH") {
    await api(base + path, method, body);
    await qc.invalidateQueries({ queryKey: [slug] });
  }
  return (
    <div className="stack">
      <h1>Settings & access</h1>
      <ErrorText
        error={access.error || members.error || teams.error || error}
      />
      <section className="card stack">
        <h2>Workspace members</h2>
        {!admin && (
          <p className="muted">
            Workspace administrators manage invitations and member roles.
          </p>
        )}
        {members.data?.members.map((m) => (
          <div className="row" key={m.subject}>
            <strong>{m.name || m.email}</strong>
            {admin
              ? (
                <Form
                  fields={[{
                    name: "role",
                    label: "Role",
                    value: m.role,
                    options: ["admin", "member"],
                  }, {
                    name: "status",
                    label: "Status",
                    value: m.status,
                    options: ["active", "suspended"],
                  }]}
                  onSubmit={(d) =>
                    write("/members", { subject: m.subject, ...d })}
                />
              )
              : <span>{m.role} · {m.status}</span>}
          </div>
        ))}
        {admin && (
          <button
            onClick={async () => {
              setError(undefined);
              try {
                const d = await api<{ token: string }>(
                  base + "/invite",
                  "POST",
                );
                setInvite(
                  `${window.location.origin}/join?token=${
                    encodeURIComponent(d.token)
                  }`,
                );
              } catch (e) {
                setError(e);
              }
            }}
          >
            Generate / reset invitation
          </button>
        )}
        {invite && (
          <label>
            Invitation link (reset invalidates the previous link)<input
              readOnly
              value={invite}
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}
      </section>
      <h2>Teams</h2>
      {teams.data?.teams.map((t) => (
        <section className="card stack" key={t.id}>
          <h3>
            {t.name}{" "}
            <span className="badge">
              {t.key} · {t.private ? "Private" : "Public"}
            </span>
          </h3>
          <Form
            label={t.joined
              ? "Leave team"
              : t.private
              ? "Confirm joining this private team"
              : "Join team"}
            fields={[]}
            onSubmit={() =>
              write(`/teams/${t.key}/membership`, {
                leave: t.joined,
                confirm_private: t.private,
              }, "POST")}
          />
          {t.private && !t.joined && (
            <p className="notice">
              Joining this private team grants access to its private issues.
              Confirm only if you intend to become a member.
            </p>
          )}
          {t.can_manage && (
            <>
              <Form
                fields={[{ name: "name", label: "Name", value: t.name }, {
                  name: "visibility",
                  label: "Visibility",
                  value: t.private ? "private" : "public",
                  options: ["public", "private"],
                }]}
                onSubmit={(d) =>
                  write(`/teams/${t.key}`, {
                    name: d.name,
                    private: d.visibility === "private",
                  })}
              />
              <TeamMembers
                team={t}
                members={members.data?.members || []}
                onWrite={write}
              />
            </>
          )}
        </section>
      ))}
    </div>
  );
}

export function TeamMembers(
  { team, members, onWrite }: {
    team: Team;
    members: Member[];
    onWrite: (path: string, body: unknown) => Promise<void>;
  },
) {
  const { slug } = useParams();
  const q = useQuery({
    queryKey: [slug, "team-members", team.key],
    queryFn: () =>
      api<{ members: TeamMember[] }>(`/w/${slug}/teams/${team.key}/members`),
  });
  return (
    <div className="stack">
      <h4>Team members</h4>
      <ErrorText error={q.error} />
      {q.data?.members.map((m) => (
        <Form
          key={m.subject}
          fields={[{
            name: "action",
            label: m.name || m.email,
            value: m.role,
            options: ["owner", "member", "remove"],
          }]}
          onSubmit={(d) =>
            onWrite(`/teams/${team.key}/members`, {
              subject: m.subject,
              ...(d.action === "remove"
                ? { remove: true }
                : { role: d.action }),
            })}
        />
      ))}
      <Form
        label="Add member"
        fields={[{
          name: "subject",
          label: "Workspace member",
          options: members.filter((m) => m.status === "active").map((m) =>
            m.subject
          ),
          optionLabels: Object.fromEntries(
            members.map((m) => [m.subject, m.name || m.email || m.subject]),
          ),
        }, { name: "role", label: "Role", options: ["member", "owner"] }]}
        onSubmit={(d) => onWrite(`/teams/${team.key}/members`, d)}
      />
    </div>
  );
}
