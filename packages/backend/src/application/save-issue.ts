import {
  createIssueSchema,
  type RequestContext,
  updateIssueSchema,
} from '../../../contracts/mod.ts';
import type { SaveIssueInput } from '../../../contracts/issue-save.ts';
import type { Service } from './mod.ts';

type Operations = Pick<
  Service,
  'createIssue' | 'updateIssue' | 'getIssue' | 'changeIssueLabels' | 'addRelation' | 'addLink'
>;
/** The composition root supplies operations sharing one database transaction. */
export async function saveIssue(
  service: Operations,
  ctx: RequestContext,
  workspace: string,
  input: SaveIssueInput,
) {
  const {
    identifier,
    add_labels,
    remove_labels,
    blocks,
    blocked_by,
    related_to,
    remove_blocks,
    remove_blocked_by,
    remove_related_to,
    links,
    ...fields
  } = input;
  const issue = identifier
    ? await service.updateIssue(ctx, workspace, identifier, updateIssueSchema.parse(fields))
    : await service.createIssue(ctx, workspace, createIssueSchema.parse(fields));
  if (add_labels?.length || remove_labels?.length) {
    await service.changeIssueLabels(ctx, workspace, {
      identifiers: [issue.identifier],
      add: add_labels,
      remove: remove_labels,
    });
  }
  const additions = { blocks, blocked_by, related: related_to };
  const removals = {
    blocks: remove_blocks,
    blocked_by: remove_blocked_by,
    related: remove_related_to,
  };
  for (const [remove, changes] of [[true, removals], [false, additions]] as const) {
    for (const kind of ['blocks', 'blocked_by', 'related'] as const) {
      for (const other of new Set(changes[kind])) {
        await service.addRelation(ctx, workspace, {
          identifier: issue.identifier,
          kind,
          other,
          remove,
        });
      }
    }
  }
  const current = await service.getIssue(ctx, workspace, issue.identifier);
  const existing = new Set(current.links.map((link) => JSON.stringify([link.title, link.url])));
  for (const link of links ?? []) {
    const key = JSON.stringify([link.title, link.url]);
    if (existing.has(key)) continue;
    await service.addLink(ctx, workspace, { identifier: issue.identifier, ...link });
    existing.add(key);
  }
  return links?.length ? service.getIssue(ctx, workspace, issue.identifier) : current;
}
