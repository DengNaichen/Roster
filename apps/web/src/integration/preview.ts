/** Preview is deliberately impossible in a production build or on a remote host. */
export function isLocalPreview(dev: boolean, flag: string | undefined, hostname: string) {
  return dev && flag === "true" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}
export const localPreview = isLocalPreview(
  import.meta.env.DEV,
  import.meta.env.VITE_LOCAL_PREVIEW,
  typeof window === "undefined" ? "" : window.location.hostname,
);
