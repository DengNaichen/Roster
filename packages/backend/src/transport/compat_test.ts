import type { Issue } from '../../../contracts/mod.ts';
import { capabilities, restCreateIssueSchema, restIssue, restListInput } from './http/compat.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
Deno.test('Original REST issue filters preserve repeated labels and full issue metadata', () => {
  const filter = restListInput({
    label_id: ['3', '5'],
    label_group_id: ['2'],
    label_mode: ['all'],
    priority: ['2'],
    assigned_to_me: ['true'],
    project_id: ['7'],
    cycle_id: ['4'],
    query: ['text'],
  });
  assert(
    JSON.stringify(filter.label_ids) === '[3,5]' &&
      JSON.stringify(filter.label_group_ids) === '[2]',
  );
  assert(
    filter.project_id === 7 && filter.cycle_id === 4 && filter.assigned_to_me === true &&
      filter.priority === 2,
  );
  let invalid = false;
  try {
    restListInput({ team: ['AL', 'SEC'] });
  } catch {
    invalid = true;
  }
  assert(invalid, 'Duplicate scalar filters must be rejected');
  const create = restCreateIssueSchema.parse({
    team: 'AL',
    title: 'Task',
    type: '',
    assignee: '',
    project_id: 7,
    cycle_id: 4,
    parent: 'AL-1',
  });
  assert(
    create.type === null && create.assignee === null && create.project_id === 7 &&
      create.cycle_id === 4 && create.parent === 'AL-1',
  );
  const issue = {
    project_id: 7,
    project: 'Project',
    project_emoji: '📚',
    cycle_id: 4,
    parent: 'AL-1',
    labels: [{ id: 3, name: 'Label' }],
  } as unknown as Issue;
  const rendered = restIssue(issue);
  assert(rendered.project_id === 7 && rendered.parent === 'AL-1' && rendered.labels[0].id === 3);
});

Deno.test('Capabilities only advertise the fully migrated domains', () => {
  assert(Object.values(capabilities).every((value) => value === true));
  assert(Object.keys(capabilities).length === 17);
});
