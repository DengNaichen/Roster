export interface LinkedPull {
  state: string;
  closes: boolean;
  completionEligible: boolean;
}
/** Completion is explicit operator opt-in; inferred links alone cannot prove acceptance. */
export function statusFromPullRequests(
  current: string,
  pulls: readonly LinkedPull[],
) {
  if (['done', 'canceled'].includes(current)) return current;
  if (
    pulls.some((p) => p.state === 'merged' && p.closes && p.completionEligible) &&
    !pulls.some((p) => ['open', 'draft'].includes(p.state))
  ) return 'done';
  if (
    pulls.some((p) => p.state === 'open' || p.state === 'merged') &&
    ['triage', 'backlog', 'todo', 'agent_ready', 'in_progress'].includes(current)
  ) return 'in_review';
  return current;
}
