import { issueTypes, statuses } from '../../../../../contracts/mod.ts';
import { fail, text } from '../../../platform/errors/validation.ts';
export function validateIssue(input: Record<string, unknown>) {
  if (input.title !== undefined) text(input.title, 'Title');
  if (
    input.description !== undefined && typeof input.description !== 'string'
  ) fail('invalid_input', 'Invalid description');
  if (input.status !== undefined && !statuses.includes(input.status as never)) {
    fail('invalid_input', 'Invalid status');
  }
  if (
    input.type !== undefined && input.type !== null &&
    !issueTypes.includes(input.type as never)
  ) fail('invalid_input', 'Invalid type');
  if (
    input.priority !== undefined &&
    (!Number.isInteger(input.priority) || Number(input.priority) < 0 ||
      Number(input.priority) > 4)
  ) fail('invalid_input', 'Invalid priority');
  if (
    input.assignee !== undefined && input.assignee !== null &&
    typeof input.assignee !== 'string'
  ) fail('invalid_input', 'Invalid assignee');
}
