import {
  Link,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Team, Workspace } from "../../../../packages/contracts/mod";
import { api, supabase } from "../api";
import { ErrorText, Form, Modal } from "../components";
import { Detail, Issues } from "./issues";
import { Settings } from "./settings";
export function Home() {
  const qc = useQueryClient(), navigate = useNavigate();
  const q = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<{ workspaces: Workspace[] }>("/workspaces"),
  });
  return (
    <main className="center stack">
      <h1>Roster workspaces</h1>
      <ErrorText error={q.error} />
      {q.isPending && <p>Loading…</p>}
      {q.data?.workspaces.map((w) => (
        <Link className="card" key={w.id} to={`/${w.slug}`}>
          {w.name} <span className="badge">{w.role}</span>
        </Link>
      ))}
      <h2>Create workspace</h2>
      <Form
        fields={[{ name: "name", label: "Name" }, {
          name: "slug",
          label: "URL slug",
        }]}
        onSubmit={async (d) => {
          const w = await api<Workspace>("/workspaces", "POST", d);
          await qc.invalidateQueries({ queryKey: ["workspaces"] });
          navigate("/" + w.slug);
        }}
      />
      <Link to="/join">Accept an invitation</Link>
      <button onClick={() => void supabase!.auth.signOut()}>Sign out</button>
    </main>
  );
}

export function Join() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  return (
    <main className="center">
      <h1>Join workspace</h1>
      <Form
        fields={[{
          name: "token",
          label: "Invitation token",
          value: params.get("token") || "",
        }]}
        label="Join"
        onSubmit={async (d) => {
          const w = await api<Workspace>("/join", "POST", d);
          navigate("/" + w.slug);
        }}
      />
    </main>
  );
}

export function WorkspaceShell() {
  const { slug } = useParams();
  const base = `/w/${slug}`;
  const q = useQuery({
    queryKey: [slug, "teams"],
    queryFn: () => api<{ teams: Team[] }>(base + "/teams"),
  });
  const qc = useQueryClient();
  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Roster</h1>
        <Link to="/">Switch workspace</Link>
        <strong>{slug}</strong>
        <nav>
          <Link to={`/${slug}`}>All issues</Link>
          {q.data?.teams.map((t) => (
            <Link key={t.id} to={`/${slug}?team=${encodeURIComponent(t.key)}`}>
              {t.private ? "🔒 " : ""}
              {t.name}
            </Link>
          ))}
          <Link to={`/${slug}/settings`}>Settings & members</Link>
        </nav>
        <ErrorText error={q.error} />
        <Modal title="Create team">
          <Form
            fields={[{ name: "key", label: "Key (e.g. ENG)" }, {
              name: "name",
              label: "Name",
            }, {
              name: "visibility",
              label: "Visibility",
              options: ["public", "private"],
            }]}
            onSubmit={async (d) => {
              await api(base + "/teams", "POST", {
                key: d.key,
                name: d.name,
                private: d.visibility === "private",
              });
              await qc.invalidateQueries({ queryKey: [slug] });
            }}
          />
        </Modal>
        <button onClick={() => void supabase!.auth.signOut()}>Sign out</button>
      </aside>
      <main className="main">
        <Routes>
          <Route index element={<Issues teams={q.data?.teams || []} />} />
          <Route path="issue/:identifier" element={<Detail />} />
          <Route path="settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
