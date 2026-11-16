export function remoteRefreshInterval(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 15_000;
  const interval = Number(value);
  if (interval === 0 || (Number.isInteger(interval) && interval >= 1000 && interval <= 60_000))
    return interval;
  throw new Error("VITE_REMOTE_REFRESH_MS must be 0 (disabled) or 1000..60000 milliseconds");
}
