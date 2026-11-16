import { FunctionRegion } from "@supabase/supabase-js";

/** Only Roster's measured project gets a default region; other deployments remain automatic. */
export function functionRegion(value: string | undefined, project: string | undefined) {
  const requested =
    value?.trim() ??
    (project?.replace(/\/$/, "") === "https://qietzaqhmforixtpicjd.supabase.co"
      ? FunctionRegion.EuWest3
      : FunctionRegion.Any);
  if (!requested) return undefined;
  const region = Object.values(FunctionRegion).find((candidate) => candidate === requested);
  if (!region) throw new Error("Invalid VITE_API_REGION");
  return region === FunctionRegion.Any ? undefined : region;
}
