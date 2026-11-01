import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./api";
import { Auth, Consent } from "./features/auth";
const Home = lazy(() =>
  import("./features/workspaces").then((m) => ({ default: m.Home }))
);
const Join = lazy(() =>
  import("./features/workspaces").then((m) => ({ default: m.Join }))
);
const WorkspaceShell = lazy(() =>
  import("./features/workspaces").then((m) => ({ default: m.WorkspaceShell }))
);
import "./style.css";
const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<unknown>(() =>
    new URLSearchParams(window.location.search).get("error_description")
  );
  const subject = useRef<string | null>(null);
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setError(error);
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (subject.current !== s?.user.id) {
        client.clear();
        subject.current = s?.user.id || null;
      }
      if (s) setError(undefined);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  if (loading) return <main className="center">Restoring session…</main>;
  if (!session) return <Auth error={error} />;
  return (
    <Suspense fallback={<main className="center">Loading workspace…</main>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/auth/callback" element={<Home />} />
        <Route path="/oauth/consent" element={<Consent />} />
        <Route path="/join" element={<Join />} />
        <Route path="/:slug/*" element={<WorkspaceShell />} />
      </Routes>
    </Suspense>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
