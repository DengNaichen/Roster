import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { configured, supabase } from "../api";
import { ErrorText, Form } from "../components";
export function Auth({ error }: { error?: unknown }) {
  const [message, setMessage] = useState("");
  return (
    <main className="center stack">
      <h1>Roster</h1>
      <ErrorText error={error} />
      <p className="muted">A shared workspace for people and agents.</p>
      {!configured
        ? (
          <div className="notice">
            <h2>Connect your deployment</h2>
            <p>
              Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and
              VITE_API_BASE_URL, then rebuild this app. No Supabase project is
              configured.
            </p>
          </div>
        )
        : (
          <>
            <Form
              label="Sign in"
              fields={[{ name: "email", label: "Email", type: "email" }, {
                name: "password",
                label: "Password",
                type: "password",
              }]}
              onSubmit={async (d) => {
                const { error } = await supabase!.auth.signInWithPassword(
                  d as { email: string; password: string },
                );
                if (error) throw error;
              }}
            />
            <Form
              label="Email me a sign-in link"
              fields={[{
                name: "email",
                label: "Email for sign-in link",
                type: "email",
              }]}
              onSubmit={async ({ email }) => {
                const { error } = await supabase!.auth.signInWithOtp({
                  email,
                  options: { emailRedirectTo: window.location.href },
                });
                if (error) throw error;
                setMessage("Check your email for the sign-in link.");
              }}
            />
            <p role="status">{message}</p>
          </>
        )}
    </main>
  );
}

export function Consent() {
  const [params] = useSearchParams();
  const id = params.get("authorization_id");
  const currentId = useRef(id);
  currentId.current = id;
  const [error, setError] = useState<unknown>();
  const [details, setDetails] = useState<OAuthAuthorizationDetails>();
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setDetails(undefined);
    setError(undefined);
    setPending(false);
    if (!id) return;
    void supabase!.auth.oauth.getAuthorizationDetails(id).then(
      ({ data, error }) => {
        if (!active) return;
        if (error) setError(error);
        else if (data && "redirect_url" in data) {
          window.location.assign(data.redirect_url);
        } else if (data) setDetails(data);
        else setError(new Error("No authorization details were returned."));
      },
    ).catch((error) => {
      if (active) setError(error);
    });
    return () => {
      active = false;
    };
  }, [id, attempt]);
  const currentDetails = details?.authorization_id === id ? details : undefined;
  async function decide(allow: boolean) {
    if (!id || !currentDetails || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const { data, error } = allow
        ? await supabase!.auth.oauth.approveAuthorization(id, {
          skipBrowserRedirect: true,
        })
        : await supabase!.auth.oauth.denyAuthorization(id, {
          skipBrowserRedirect: true,
        });
      if (currentId.current !== id) return;
      if (error) throw error;
      if (!data?.redirect_url) {
        throw new Error("Authorization did not return a redirect URL.");
      }
      window.location.assign(data.redirect_url);
    } catch (error) {
      if (currentId.current === id) setError(error);
    } finally {
      if (currentId.current === id) setPending(false);
    }
  }
  return (
    <main className="center stack">
      <h1>Authorize access to Roster</h1>
      {!id ? <p role="alert">Missing authorization_id.</p> : (
        <>
          <p>Review the requesting application and access before continuing.</p>
          {currentDetails
            ? <AuthorizationDetails details={currentDetails} />
            : !error && <p>Loading authorization…</p>}
          <ErrorText error={error} />
          {error && !currentDetails && (
            <button onClick={() => setAttempt((n) => n + 1)}>
              Retry authorization details
            </button>
          )}
          <div className="row">
            <button
              disabled={!currentDetails || pending}
              onClick={() => void decide(true)}
            >
              {pending ? "Saving decision…" : "Approve"}
            </button>
            <button
              disabled={!currentDetails || pending}
              onClick={() => void decide(false)}
            >
              Deny
            </button>
          </div>
        </>
      )}
    </main>
  );
}
export function AuthorizationDetails(
  { details }: { details: OAuthAuthorizationDetails },
) {
  return (
    <section className="card">
      <h2>{details.client.name}</h2>
      {details.client.uri && <p>{details.client.uri}</p>}
      <h3>Requested permissions</h3>
      <ul>
        {details.scope.split(" ").filter(Boolean).map((scope) => (
          <li key={scope}>{scope}</li>
        ))}
      </ul>
      <p>Approval allows this application to act with the permissions above.</p>
    </section>
  );
}
