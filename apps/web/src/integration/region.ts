import { FunctionRegion } from "@supabase/supabase-js";

/** Known Roster projects run beside their primary database; others remain automatic. */
export function functionRegion(value: string | undefined, project: string | undefined) {
  const projectUrl = project?.replace(/\/$/, "");
  const requested =
    value?.trim() ??
    (projectUrl === "https://jmmwgdyfcmonzqkurcly.supabase.co"
      ? FunctionRegion.ApNortheast1
      : projectUrl === "https://qietzaqhmforixtpicjd.supabase.co"
        ? FunctionRegion.EuWest3
        : FunctionRegion.Any);
  if (!requested) return undefined;
  const region = Object.values(FunctionRegion).find((candidate) => candidate === requested);
  if (!region) throw new Error("Invalid VITE_API_REGION");
  return region === FunctionRegion.Any ? undefined : region;
}
