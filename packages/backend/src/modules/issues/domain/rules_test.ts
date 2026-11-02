import { statusFromPullRequest } from './pull-request.ts';
import { validateIssue } from './rules.ts';
Deno.test('Pull request transitions preserve terminal task states and closed PRs do not cancel tasks', () => {
  for (const terminal of ['done', 'canceled']) {
    for (const state of ['open', 'merged', 'closed', 'draft']) {
      if (statusFromPullRequest(terminal, state) !== terminal) {
        throw new Error('Terminal status changed');
      }
    }
  }
  const cases = [['todo', 'open', 'in_review'], ['in_review', 'merged', 'done'], [
    'in_progress',
    'closed',
    'in_progress',
  ]];
  for (const [current, pull, expected] of cases) {
    if (statusFromPullRequest(current, pull) !== expected) throw new Error(`${current}/${pull}`);
  }
});
Deno.test('Issue field rules are usable without a database and reject malformed values', () => {
  for (
    const input of [{ title: ' ' }, { priority: 5 }, { priority: 1.5 }, { status: 'unknown' }, {
      assignee: 42,
    }]
  ) {
    let rejected = false;
    try {
      validateIssue(input);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`Accepted ${JSON.stringify(input)}`);
  }
  validateIssue({ title: 'Valid', priority: 0, type: null, assignee: null });
});
