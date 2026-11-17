import { validateIssue } from './rules.ts';
import { statusFromPullRequests } from './pull-request.ts';
Deno.test('PR status policy aggregates eligible closing merges and preserves terminal tasks', () => {
  const closing = { state: 'merged', closes: true, completionEligible: true };
  const cases = [
    { current: 'done', pulls: [closing], expected: 'done' },
    { current: 'canceled', pulls: [closing], expected: 'canceled' },
    { current: 'todo', pulls: [{ ...closing, state: 'draft' }], expected: 'todo' },
    { current: 'todo', pulls: [{ ...closing, state: 'closed' }], expected: 'todo' },
    { current: 'todo', pulls: [{ ...closing, state: 'open' }], expected: 'in_review' },
    {
      current: 'in_review',
      pulls: [{ ...closing, completionEligible: false }],
      expected: 'in_review',
    },
    { current: 'in_review', pulls: [{ ...closing, closes: false }], expected: 'in_review' },
    {
      current: 'in_review',
      pulls: [closing, { ...closing, state: 'draft' }],
      expected: 'in_review',
    },
    { current: 'in_review', pulls: [closing], expected: 'done' },
    {
      current: 'in_review',
      pulls: [closing, { ...closing, state: 'closed', closes: false }],
      expected: 'done',
    },
  ];
  for (const c of cases) {
    if (statusFromPullRequests(c.current, c.pulls) !== c.expected) throw new Error(c.expected);
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
