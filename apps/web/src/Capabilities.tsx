import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api } from "./shared";
export const capabilityNames = ["workspaces", "members", "teams", "issues", "assignees", "projects", "initiatives", "labels", "cycles", "comments", "work_logs", "delegations", "relations", "links", "pull_requests", "assignments"] as const;
export type Capability = typeof capabilityNames[number];
export type Capabilities = Record<Capability, boolean>;
const Context = createContext<Capabilities | null>(null);
export function useCapabilities() {
  const value = useContext(Context);
  if (!value) throw new Error("Capabilities must be loaded before opening this page.");
  return value;
}
export function CapabilitiesProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [value, setValue] = useState<Capabilities | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setValue(null); setError("");
    api<{capabilities: Capabilities}>(`/api/w/${encodeURIComponent(slug)}/capabilities`).then(result => {
      if (!capabilityNames.every(key => typeof result.capabilities?.[key] === "boolean")) throw new Error("The server returned incomplete capabilities.");
      if (active) setValue(result.capabilities);
    }).catch(cause => {if (active) setError(cause.message);});
    return () => {active = false;};
  }, [slug, attempt]);
  if (!value) return <main className="panel first-workspace">{error ? <><p className="error" role="alert">{error}</p><button className="button" onClick={() => setAttempt(n => n + 1)}>Retry capabilities</button></> : <p className="empty">Loading workspace capabilities…</p>}</main>;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function FeatureUnavailable({ name }: { name: string }) {
  return <div className="scope-message" role="status"><h2>{name}</h2><p>This feature has not been migrated to Roster yet.</p></div>;
}
export function UnavailableField({ name }: { name: string }) {
  return <span className="muted" title="This feature has not been migrated to Roster yet.">{name} · Not migrated yet</span>;
}
