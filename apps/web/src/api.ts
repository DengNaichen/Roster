import { createClient } from "@supabase/supabase-js";
export const configured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY &&
    import.meta.env.VITE_API_BASE_URL,
);
export const supabase = configured
  ? createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    { auth: { flowType: "pkce", detectSessionInUrl: true } },
  )
  : null;
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const session = await supabase?.auth.getSession();
  if (!session?.data.session) {
    throw new Error("Sign in to continue. Your draft has been kept.");
  }
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "")}/api${path}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.data.session.access_token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message || `Request failed (${response.status})`,
    );
  }
  return data as T;
}
// A failed write must not prevent later writes to the same issue.
export function createWriteQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function enqueue<T>(key: string, write: () => Promise<T>): Promise<T> {
    const next = (tails.get(key) ?? Promise.resolve()).catch(() => undefined)
      .then(write);
    tails.set(key, next);
    void next.finally(() => {
      if (tails.get(key) === next) tails.delete(key);
    }).catch(() => undefined);
    return next;
  };
}
export const enqueue = createWriteQueue();
