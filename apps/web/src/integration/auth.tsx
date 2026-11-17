import googleMark from "../assets/google-sign-in.png";
import githubMark from "../assets/github-invertocat.svg";
import {
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { RosterLogo } from "../RosterLogo";
import { api, configured, localPreview, supabase } from "./api";
type Identity = { subject: string; name: string; email: string };
type State = {
  identity: Identity | null;
  loading: boolean;
  needsLogin: boolean;
  preview: boolean;
  signOut: () => Promise<void>;
};
const previewIdentity = {
  subject: "b965fa67-d823-4534-a240-56b88f839dad",
  name: "Local Developer",
  email: "developer@roster.local",
};
const SessionContext = createContext<State>({
  identity: null,
  loading: true,
  needsLogin: false,
  preview: false,
  signOut: async () => {},
});
export const useSession = () => useContext(SessionContext);
function safeReturn() {
  const target = new URLSearchParams(window.location.search).get("return_to") ?? "/";
  if (!target.startsWith("/") || target.startsWith("//") || /[\\\s]/u.test(target)) return "/";
  const url = new URL(target, window.location.origin);
  if (url.pathname.startsWith("//") || ["/auth/login", "/auth/callback"].includes(url.pathname))
    return "/";
  return url.origin === window.location.origin ? url.pathname + url.search + url.hash : "/";
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error ?? ""));
function Login({ error: initial }: { error?: unknown }) {
  const [error, setError] = useState<unknown>(initial);
  const [pending, setPending] = useState<"google" | "github" | null>(null);
  async function signIn(provider: "google" | "github") {
    if (!supabase) {
      setError("Sign-in is not configured for this preview.");
      return;
    }
    setPending(provider);
    setError(undefined);
    try {
      const { pathname, search, hash, origin } = window.location;
      const callback = new URL("/auth/callback", origin);
      callback.searchParams.set(
        "return_to",
        ["/auth/login", "/auth/callback"].includes(pathname)
          ? safeReturn()
          : pathname + search + hash,
      );
      const result = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: callback.href },
      });
      if (result.error) throw result.error;
    } catch (e) {
      setError(e);
      setPending(null);
    }
  }
  return (
    <main className="roster-login">
      <section aria-labelledby="login-title" className="roster-login-card">
        <RosterLogo className="roster-login-mark" />
        <h1 id="login-title">Log in to Roster</h1>
        {(["google", "github"] as const).map((provider) => {
          const name = provider === "google" ? "Google" : "GitHub";
          return (
            <button
              key={provider}
              className={provider === "google" ? "roster-login-primary" : undefined}
              type="button"
              disabled={pending !== null}
              onClick={() => void signIn(provider)}
            >
              <img
                src={provider === "google" ? googleMark : githubMark}
                className={provider === "github" ? "roster-login-github-mark" : undefined}
                width="20"
                height="20"
                alt=""
              />
              {pending === provider ? `Connecting to ${name}…` : `Continue with ${name}`}
            </button>
          );
        })}
        {Boolean(error) && <p role="alert">{message(error)}</p>}
        <p className="roster-login-note">New here? Choose either option to sign up.</p>
      </section>
    </main>
  );
}
function ReturnAfterLogin() {
  useEffect(() => {
    window.location.replace(safeReturn());
  }, []);
  return <main className="integration-auth">Opening workspace…</main>;
}
type AuthorizationDetails = {
  id: string;
  clientId: string;
  redirectUri: string;
  access: "read" | "read_write";
  workspaces: { id: string; slug: string; name: string }[];
};
function Consent({ identity }: { identity: Identity | null }) {
  const id = new URLSearchParams(window.location.search).get("authorization_id");
  const current = useRef(id);
  current.current = id;
  const [details, setDetails] = useState<AuthorizationDetails>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [workspace, setWorkspace] = useState("");
  const [access, setAccess] = useState<"read" | "read_write">("read");
  useEffect(() => {
    let active = true;
    setDetails(undefined);
    setError(undefined);
    if (!id || !supabase) return;
    void api<AuthorizationDetails>(`/api/oauth/authorizations/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!active) return;
        setDetails(data);
        setWorkspace(data.workspaces.length === 1 ? data.workspaces[0].slug : "");
        setAccess("read");
      })
      .catch((e) => {
        if (active) setError(e);
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);
  const currentDetails = details?.id === id ? details : undefined;
  async function decide(allow: boolean) {
    if (!id || !currentDetails || pending || localPreview) return;
    setPending(true);
    try {
      const data = await api<{ redirect_url: string }>(
        `/api/oauth/authorizations/${encodeURIComponent(id)}`,
        "POST",
        allow ? { workspace, access } : { action: "deny" },
      );
      if (current.current !== id) return;
      if (!data.redirect_url) throw new Error("Missing authorization redirect");
      window.location.assign(data.redirect_url);
    } catch (e) {
      if (current.current === id) setError(e);
    } finally {
      if (current.current === id) setPending(false);
    }
  }
  const accountLabel = identity
    ? identity.name && identity.email && identity.name !== identity.email
      ? `${identity.name} (${identity.email})`
      : identity.email || identity.name || identity.subject
    : "";
  return (
    <main className="integration-auth">
      <section className="roster-consent-card" aria-labelledby="consent-title">
        <RosterLogo className="roster-consent-mark" />
        <h1 id="consent-title">Authorize Roster access</h1>
        {accountLabel && <p className="roster-consent-account">Signed in as {accountLabel}</p>}
        {!id ? (
          <>
            <p role="alert">
              Missing authorization_id. Start the MCP login flow from your coding agent again.
            </p>
            <div className="roster-consent-actions">
              <a className="button" href="/">
                Back to Roster
              </a>
            </div>
          </>
        ) : localPreview ? (
          <>
            <p>
              Local preview connects coding agents directly over loopback without OAuth. Copy the
              preview MCP URL from Settings → Integrations.
            </p>
            <div className="roster-consent-actions">
              <a className="button" href="/">
                Back to Roster
              </a>
            </div>
          </>
        ) : (
          <>
            {currentDetails ? (
              <div className="roster-consent-details">
                <h2>Connect your coding agent</h2>
                <details>
                  <summary>Connection details</summary>
                  <p className="roster-consent-uri">Client: {currentDetails.clientId}</p>
                  <p className="roster-consent-uri">Return address: {currentDetails.redirectUri}</p>
                </details>
                <p>
                  Choose one workspace and the access this connection needs. Private team
                  permissions still apply. Switching workspaces in Roster does not change this
                  connection.
                </p>
                <label>
                  Workspace
                  <select
                    aria-label="Workspace"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    disabled={pending}
                  >
                    <option value="">Choose a workspace</option>
                    {currentDetails.workspaces.map((w) => (
                      <option key={w.id} value={w.slug}>
                        {w.name} ({w.slug})
                      </option>
                    ))}
                  </select>
                </label>
                {currentDetails.workspaces.length === 0 && (
                  <p>Join or create a workspace in Roster before connecting.</p>
                )}
                <label>
                  Access
                  <select
                    aria-label="Access"
                    value={access}
                    onChange={(e) => setAccess(e.target.value as "read" | "read_write")}
                    disabled={pending}
                  >
                    <option value="read">Read only</option>
                    {currentDetails.access === "read_write" && (
                      <option value="read_write">Read and write</option>
                    )}
                  </select>
                </label>
                <p>
                  Read only lets the agent inspect tasks, specs and projects. Read and write also
                  lets it make changes using your existing permissions.
                </p>
              </div>
            ) : (
              !error && <p className="roster-consent-loading">Loading authorization…</p>
            )}
            {Boolean(error) && (
              <div className="roster-consent-error">
                <p role="alert">{message(error)}</p>
                <div className="roster-consent-actions">
                  <button className="button" type="button" onClick={() => setAttempt((n) => n + 1)}>
                    Retry
                  </button>
                  <a className="button" href="/">
                    Back to Roster
                  </a>
                </div>
              </div>
            )}
            <div className="roster-consent-actions">
              <button
                className="button primary"
                type="button"
                disabled={!currentDetails || !workspace || pending}
                onClick={() => void decide(true)}
              >
                {pending ? "Authorizing…" : "Approve"}
              </button>
              <button
                className="button"
                type="button"
                disabled={!currentDetails || pending}
                onClick={() => void decide(false)}
              >
                Deny
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
export function AuthBoundary({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!localPreview && configured);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState<unknown>();
  const everAuthenticated = useRef(localPreview);
  const lastSubject = useRef<string | null>(null);
  const [signedOut, setSignedOut] = useState(window.location.pathname === "/auth/signed-out");
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const apply = (s: Session | null) => {
      if (!active) return;
      setSession(s);
      setLoading(false);
      if (s) {
        everAuthenticated.current = true;
        setNeedsLogin(false);
        setSignedOut(false);
      } else if (everAuthenticated.current) setNeedsLogin(true);
    };
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) setError(error);
        apply(data.session);
      })
      .catch((e) => {
        setError(e);
        setLoading(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => apply(s));
    const expire = () => setNeedsLogin(true);
    window.addEventListener("session-expired", expire);
    return () => {
      active = false;
      data.subscription.unsubscribe();
      window.removeEventListener("session-expired", expire);
    };
  }, []);
  const identity = localPreview
    ? previewIdentity
    : session
      ? {
          subject: session.user.id,
          name: String(
            session.user.user_metadata?.name ?? session.user.user_metadata?.full_name ?? "",
          ),
          email: session.user.email ?? "",
        }
      : null;
  if (identity) lastSubject.current = identity.subject;
  const appContent = <Fragment key={lastSubject.current}>{children}</Fragment>;
  async function signOut() {
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    }
    setSignedOut(true);
    window.location.assign("/auth/signed-out");
  }
  const state = {
    identity,
    loading,
    needsLogin,
    preview: localPreview,
    signOut,
  };
  const path = window.location.pathname;
  let content: ReactNode;
  if (loading) {
    content = <main className="integration-auth">Restoring session…</main>;
  } else if (signedOut) {
    content = (
      <main className="integration-auth">
        <h1>Signed out</h1>
        <a href="/auth/login">Sign in</a>
      </main>
    );
  } else if (!identity && !everAuthenticated.current) {
    content = (
      <Login
        error={error || new URLSearchParams(window.location.search).get("error_description")}
      />
    );
  } else if (path === "/auth/login" && localPreview) {
    content = (
      <main className="integration-auth">
        <h1>Local preview</h1>
        <a href={safeReturn()}>Enter preview</a>
      </main>
    );
  } else if (path === "/auth/login" || path === "/auth/callback") {
    content = <ReturnAfterLogin />;
  } else if (path === "/oauth/consent") content = <Consent identity={identity} />;
  else if (path === "/join") {
    window.history.replaceState({}, "", `/auth/join${window.location.search}`);
    content = appContent;
  } else {
    content = (
      <>
        {needsLogin && (
          <aside className="session-bar" role="alert">
            Session expired. Your unsaved text stays here.{" "}
            <a
              href={`/auth/login?return_to=${encodeURIComponent(path + window.location.search)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Sign in again
            </a>
          </aside>
        )}
        {appContent}
      </>
    );
  }
  return <SessionContext.Provider value={state}>{content}</SessionContext.Provider>;
}
