import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  IssueDetail,
  IssuePage,
  Team,
} from "../../../../packages/contracts/mod";
import { statuses } from "../../../../packages/contracts/mod";
import { api, enqueue } from "../api";
import { ErrorText, Form, Modal } from "../components";
export function Issues({ teams }: { teams: Team[] }) {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const team = params.get("team") || "";
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: [slug, "issues", team, query],
    queryFn: () =>
      api<IssuePage>(
        `/w/${slug}/issues?${new URLSearchParams({ team, query })}`,
      ),
  });
  const qc = useQueryClient();
  return (
    <>
      <div className="row spread toolbar">
        <h1>{team || "All"} issues</h1>
        <Modal title="Create issue">
          <Form
            fields={[
              {
                name: "team",
                label: "Team",
                options: teams.filter((t) => t.accessible).map((t) => t.key),
                value: team,
              },
              { name: "title", label: "Title" },
              { name: "description", label: "Description", type: "textarea" },
              {
                name: "status",
                label: "Status",
                options: [...statuses],
                value: "backlog",
              },
            ]}
            onSubmit={async (d) => {
              const issue = await api<IssueDetail>(
                `/w/${slug}/issues`,
                "POST",
                d,
              );
              await qc.invalidateQueries({ queryKey: [slug, "issues"] });
              navigate(`/${slug}/issue/${issue.identifier}`);
            }}
          />
        </Modal>
      </div>
      <label>
        Search<input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search issues"
        />
      </label>
      <ErrorText error={q.error} />
      {q.isPending
        ? <p>Loading issues…</p>
        : q.data?.items.length === 0
        ? <p className="muted">No issues match this view.</p>
        : q.data?.items.map((i) => (
          <Link
            className="issue"
            key={i.id}
            to={`/${slug}/issue/${i.identifier}`}
          >
            <span className="muted">{i.identifier}</span>
            <strong>{i.title}</strong>
            <span>{i.status.replaceAll("_", " ")}</span>
            <span className="badge">{i.assignee?.name || "Unassigned"}</span>
          </Link>
        ))}
      {q.data?.next_cursor && (
        <button
          onClick={async () => {
            try {
              const next = await api<IssuePage>(
                `/w/${slug}/issues?${new URLSearchParams({
                  team,
                  query,
                  cursor: q.data.next_cursor!,
                })}`,
              );
              qc.setQueryData([slug, "issues", team, query], {
                items: [...q.data!.items, ...next.items],
                next_cursor: next.next_cursor,
              });
            } catch (e) {
              window.alert(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Load more
        </button>
      )}
    </>
  );
}

export function Detail() {
  const { slug, identifier } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [slug, "issue", identifier],
    queryFn: () => api<IssueDetail>(`/w/${slug}/issues/${identifier}`),
  });
  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      enqueue(
        `${slug}/${identifier}`,
        () => api(`/w/${slug}/issues/${identifier}`, "PATCH", d),
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [slug, "issue", identifier] });
      await qc.invalidateQueries({ queryKey: [slug, "issues"] });
    },
  });
  if (!q.data) {
    return (
      <>
        <ErrorText error={q.error} />
        {q.isPending && <p>Loading issue…</p>}
      </>
    );
  }
  const i = q.data;
  return (
    <div className="stack">
      <Link to={`/${slug}`}>← Issues</Link>
      <p className="muted">{i.identifier}</p>
      <h1>{i.title}</h1>
      <div className="row">
        <label>
          Status<select
            value={i.status}
            onChange={(e) => mutation.mutate({ status: e.target.value })}
          >
            {statuses.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Priority<select
            value={i.priority}
            onChange={(e) =>
              mutation.mutate({ priority: Number(e.target.value) })}
          >
            {["None", "Urgent", "High", "Medium", "Low"].map((s, n) => (
              <option value={n} key={n}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <ErrorText error={mutation.error} />
      <pre>{i.description||'No description.'}</pre>
      <Modal title="Edit issue">
        <Form
          key={i.id}
          fields={[{ name: "title", label: "Title", value: i.title }, {
            name: "description",
            label: "Description",
            type: "textarea",
            value: i.description,
          }]}
          onSubmit={(d) => mutation.mutateAsync(d)}
        />
      </Modal>
      <h2>Activity</h2>
      {i.audit.map((a) => (
        <div className="card" key={a.id}>
          <strong>{a.kind}</strong>
          <p className="muted">{new Date(a.created_at).toLocaleString()}</p>
          <pre>{JSON.stringify(a.after,null,2)}</pre>
        </div>
      ))}
    </div>
  );
}
