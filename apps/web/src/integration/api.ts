import { createClient } from "@supabase/supabase-js";
import { localPreview } from "./preview";
export { localPreview } from "./preview";
export const configured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY &&
    import.meta.env.VITE_API_BASE_URL,
);
export const supabase = configured && !localPreview
  ? createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    { auth: { flowType: "pkce", detectSessionInUrl: true } },
  )
  : null;
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!path.startsWith("/api/") || path.includes("://")) {
    throw new Error("API path must start with /api/");
  }
  const session = localPreview ? null : await supabase?.auth.getSession();
  if (!localPreview && !session?.data.session) {
    window.dispatchEvent(new Event("session-expired"));
    throw new Error("Sign in to continue. Your draft has been kept.");
  }
  const headers = new Headers(init.headers);
  if (localPreview) headers.delete("Authorization");
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!localPreview && session?.data.session) {
    headers.set("Authorization", `Bearer ${session.data.session.access_token}`);
  }
  const base = localPreview
    ? "http://127.0.0.1:18471"
    : import.meta.env.VITE_API_BASE_URL;
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
  });
  if (response.status === 401) {
    window.dispatchEvent(new Event("session-expired"));
  }
  return response;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: object,
): Promise<T> {
  const response = await apiFetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message || `Request failed (${response.status})`,
    ), { status: response.status, code: typeof data.error === "object" ? data.error?.code : undefined });
  }
  return data as T;
}
