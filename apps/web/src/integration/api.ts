import { functionRegion } from "./region";
import { createClient } from "@supabase/supabase-js";
import { localPreview } from "./preview";
export { localPreview } from "./preview";
export const configured = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY &&
    import.meta.env.VITE_API_BASE_URL,
);
export const supabase =
  configured && !localPreview
    ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
        auth: { flowType: "pkce", detectSessionInUrl: true },
      })
    : null;
function safePreviewApiPort() {
  const previewPort = Number(import.meta.env.VITE_PREVIEW_API_PORT || "18471");
  return Number.isInteger(previewPort) && previewPort > 0 && previewPort <= 65535
    ? previewPort
    : 18471;
}
export function mcpServerUrl(slug: string): string {
  const encoded = encodeURIComponent(slug);
  if (localPreview) {
    return `http://127.0.0.1:${safePreviewApiPort()}/w/${encoded}/mcp`;
  }
  const mcpBase = String(import.meta.env.VITE_MCP_BASE_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (mcpBase) return `${mcpBase}/w/${encoded}/mcp`;
  const apiBase = String(import.meta.env.VITE_API_BASE_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (apiBase) {
    const resolved = apiBase.endsWith("/functions/v1/api")
      ? `${apiBase.slice(0, -"/functions/v1/api".length)}/functions/v1/mcp`
      : apiBase;
    return `${resolved}/w/${encoded}/mcp`;
  }
  return `${window.location.origin}/w/${encoded}/mcp`;
}
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  subject?: string,
): Promise<Response> {
  if (!path.startsWith("/api/") || path.includes("://")) {
    throw new Error("API path must start with /api/");
  }
  const session = localPreview ? null : await supabase?.auth.getSession();
  if (init.signal?.aborted) throw init.signal.reason;
  if (!localPreview && !session?.data.session) {
    window.dispatchEvent(new Event("session-expired"));
    throw new Error("Sign in to continue. Your draft has been kept.");
  }
  if (!localPreview && subject && session?.data.session?.user.id !== subject)
    throw new DOMException("Request identity changed", "AbortError");
  const headers = new Headers(init.headers);
  if (localPreview) headers.delete("Authorization");
  // Region is only a routing hint; it never changes authorization or retries a mutation.
  const region = localPreview
    ? undefined
    : functionRegion(import.meta.env.VITE_API_REGION, import.meta.env.VITE_SUPABASE_URL);
  if (region) headers.set("x-region", region);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!localPreview && session?.data.session) {
    headers.set("Authorization", `Bearer ${session.data.session.access_token}`);
  }
  const base = localPreview
    ? `http://127.0.0.1:${safePreviewApiPort()}`
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
export type ReadOptions = {
  signal?: AbortSignal;
  subject?: string;
  conditional?: { tag: string; value: unknown };
  onValidator?: (tag: string | null) => void;
};
async function requestApi<T>(
  path: string,
  method = "GET",
  body?: object,
  options: ReadOptions = {},
): Promise<T> {
  const response = await apiFetch(
    path,
    {
      signal: options.signal,
      method,
      cache: method === "GET" ? "no-store" : undefined,
      headers: options.conditional ? { "If-None-Match": options.conditional.tag } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    options.subject,
  );
  if (response.status === 304) {
    options.signal?.throwIfAborted();
    if (!options.conditional) throw new Error("Received 304 without cached data");
    options.onValidator?.(response.headers.get("ETag") ?? options.conditional.tag);
    return options.conditional.value as T;
  }
  const data = await response.json();
  options.signal?.throwIfAborted();
  if (!response.ok) {
    throw Object.assign(
      new Error(
        typeof data.error === "string"
          ? data.error
          : data.error?.message || `Request failed (${response.status})`,
      ),
      {
        status: response.status,
        code: typeof data.error === "object" ? data.error?.code : undefined,
      },
    );
  }
  options.onValidator?.(response.headers.get("ETag"));
  return data as T;
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: object,
  options: ReadOptions = {},
): Promise<T> {
  // Bound session refresh, headers and body, including a stalled polling read.
  // Never automatically retry an uncertain write.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  let rejectAbort: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error(
          method === "GET" || method === "HEAD"
            ? "Request timed out. Try again."
            : "Save not confirmed. Refreshing to check the result.",
        ),
      ),
    30_000,
  );
  try {
    return await Promise.race([
      requestApi<T>(path, method, body, { ...options, signal: controller.signal }),
      interrupted,
    ]);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
    controller.signal.removeEventListener("abort", abort);
  }
}
