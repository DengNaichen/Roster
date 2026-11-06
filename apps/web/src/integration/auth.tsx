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
import type { OAuthAuthorizationDetails, Session } from "@supabase/supabase-js";
import { RosterLogo } from "../RosterLogo";
import { configured, localPreview, supabase } from "./api";
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
function Consent() {
  const id = new URLSearchParams(window.location.search).get("authorization_id");
  const current = useRef(id);
  current.current = id;
  const [details, setDetails] = useState<OAuthAuthorizationDetails>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setDetails(undefined);
    setError(undefined);
    if (!id || !supabase) return;
    void supabase.auth.oauth
      .getAuthorizationDetails(id)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) throw error;
        if (data && "redirect_url" in data) {
          window.location.assign(data.redirect_url);
        } else if (data) setDetails(data);
      })
      .catch((e) => {
        if (active) setError(e);
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);
  const currentDetails = details?.authorization_id === id ? details : undefined;
  async function decide(allow: boolean) {
    if (!id || !currentDetails || pending || localPreview) return;
    setPending(true);
    try {
      const { data, error } = allow
        ? await supabase!.auth.oauth.approveAuthorization(id, {
            skipBrowserRedirect: true,
          })
        : await supabase!.auth.oauth.denyAuthorization(id, {
            skipBrowserRedirect: true,
          });
      if (current.current !== id) return;
      if (error) throw error;
      if (!data?.redirect_url) {
        throw new Error("Missing authorization redirect");
      }
      window.location.assign(data.redirect_url);
    } catch (e) {
      if (current.current === id) setError(e);
    } finally {
      if (current.current === id) setPending(false);
    }
  }
  return (
    <main className="integration-auth">
      <h1>Authorize Roster access</h1>
      {!id ? (
        <p role="alert">Missing authorization_id.</p>
      ) : localPreview ? (
        <p>OAuth authorization requires a configured Supabase account.</p>
      ) : (
        <>
          {currentDetails ? (
            <>
              <h2>{currentDetails.client.name}</h2>
              <p>{currentDetails.client.uri}</p>
              <p>
                This application can act with your Roster workspace permissions. The following
                scopes control profile information:
              </p>
              <ul>
                {currentDetails.scope
                  .split(" ")
                  .filter(Boolean)
                  .map((scope) => (
                    <li key={scope}>{scope}</li>
                  ))}
              </ul>
            </>
          ) : (
            !error && <p>Loading authorization…</p>
          )}
          {Boolean(error) && (
            <>
              <p role="alert">{message(error)}</p>
              <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
            </>
          )}
          <button disabled={!currentDetails || pending} onClick={() => void decide(true)}>
            Approve
          </button>
          <button disabled={!currentDetails || pending} onClick={() => void decide(false)}>
            Deny
          </button>
        </>
      )}
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
  } else if (path === "/oauth/consent") content = <Consent />;
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
