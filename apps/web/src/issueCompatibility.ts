// These placeholders only keep the copied view's structural contract intact.
// Capability gates display "Not migrated" instead of interpreting them as data.
function issue(value: unknown, detail: boolean): unknown {
  if (!value || typeof value !== "object" || !("identifier" in value)) return value;
  const result = { labels: [], ...value };
  if (!detail) return result;
  return { decisions: [], delegations: [], assignments: [], comments: [], links: [], pull_requests: [], children: [], blocks: [], blocked_by: [], related: [], work_log_count: 0, ...result };
}
export function normalizeIssueResponse(path: string, method: string, value: unknown): unknown {
  if (!/\/issues(?:[/?]|$)/.test(path)) return value;
  if (value && typeof value === "object" && "issues" in value && Array.isArray(value.issues)) return {...value, issues: value.issues.map(entry => issue(entry, false))};
  return issue(value, method === "GET" && /\/issues\/[^/?]+(?:\?.*)?$/.test(path));
}
