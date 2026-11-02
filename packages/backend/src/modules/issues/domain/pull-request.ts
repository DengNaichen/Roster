export function statusFromPullRequest(current: string, pullState: string) {
  if (pullState === 'merged' && !['done', 'canceled'].includes(current)) return 'done';
  if (
    pullState === 'open' &&
    ['triage', 'backlog', 'todo', 'agent_ready', 'in_progress'].includes(current)
  ) return 'in_review';
  return current;
}
