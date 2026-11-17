import { z } from 'zod';
import { addLinkSchema, addRelationSchema } from './activity.ts';
import { createIssueSchema } from './schemas.ts';

const relations = z.array(addRelationSchema.shape.other).max(100).optional();
const labels = z.array(z.number().int().positive().max(2147483647)).max(100).optional();
export const saveIssueSchema = createIssueSchema.partial().extend({
  identifier: addRelationSchema.shape.identifier.optional(),
  add_labels: labels,
  remove_labels: labels,
  blocks: relations,
  blocked_by: relations,
  related_to: relations,
  remove_blocks: relations,
  remove_blocked_by: relations,
  remove_related_to: relations,
  links: z.array(addLinkSchema.omit({ identifier: true })).max(100).optional(),
}).superRefine((input, ctx) => {
  if (!input.identifier) {
    for (const field of ['team', 'title'] as const) {
      if (!input[field]) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Required when creating an issue' });
      }
    }
  } else if (input.team !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['team'],
      message: 'Team cannot be changed when updating an issue',
    });
  }
  for (const field of ['blocks', 'blocked_by', 'related_to'] as const) {
    if (input[field]?.some((id) => input[`remove_${field}`]?.includes(id))) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'Cannot add and remove the same relation',
      });
    }
  }
});
export type SaveIssueInput = z.infer<typeof saveIssueSchema>;
