import type { Label } from '../../../../../contracts/catalog.ts';
import * as schemas from '../../../../../contracts/catalog.ts';
import type { CatalogService } from '../../../application/catalog.ts';
import type { Row } from '../../../application/records.ts';
import type { Session, UnitOfWork } from '../../../application/session.ts';
import { touchIssue } from '../../issues/index.ts';

import { fail } from '../../../platform/errors/validation.ts';
import { workspace } from '../../access/index.ts';
import { readIssue } from '../../issues/index.ts';

import { translate } from '../../../platform/errors/catalog.ts';
import { parse } from '../../../platform/errors/parse.ts';
export function labelDTO(row: Row): Label {
  return {
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description),
    color: String(row.color),
    group_id: Number(row.group_id ?? 0),
    archived: Boolean(row.archived),
  };
}
async function labelRow(db: Session, workspaceId: unknown, id: number): Promise<Row> {
  const row = (await db.labels.findLabel({ workspaceId, id }))[0];
  if (!row) fail('not_found', 'Label not found');
  return row;
}

export function createLabelService(
  db: UnitOfWork,
): Pick<
  CatalogService,
  | 'listLabels'
  | 'listLabelGroups'
  | 'saveLabelGroup'
  | 'createLabel'
  | 'updateLabel'
  | 'changeIssueLabels'
  | 'mergeLabels'
> {
  return {
    async listLabels(ctx, slug, input = {}) {
      const q = parse(schemas.listLabelsSchema, input);
      const w = await workspace(db, ctx, slug);
      return (await db.labels.listLabels({
        workspaceId: w.id,
        include_archived: q.include_archived ?? false,
      })).map(labelDTO);
    },
    async listLabelGroups(ctx, slug, input = {}) {
      parse(schemas.listLabelGroupsSchema, input);
      const w = await workspace(db, ctx, slug);
      return (await db.labels.listGroups({ workspaceId: w.id })).map((row) => ({
        id: Number(row.id),
        name: String(row.name),
      }));
    },
    async saveLabelGroup(ctx, slug, input) {
      const q = parse(schemas.saveLabelGroupSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const row = !q.id
            ? await tx.labels.insertGroup({
              workspaceId: w.id,
              name: q.name,
              toLowerCase: q.name.toLowerCase(),
            })
            : await tx.labels.renameGroup({
              name: q.name,
              toLowerCase: q.name.toLowerCase(),
              workspaceId: w.id,
              id: q.id,
            });
          return { id: Number(row.id), name: String(row.name) };
        })
      );
    },
    async createLabel(ctx, slug, input) {
      const q = parse(schemas.createLabelSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          if (
            q.group_id &&
            !(await tx.labels.findGroup({ workspaceId: w.id, group_id: q.group_id })).length
          ) fail('not_found', 'Label group not found');
          return labelDTO(
            await tx.labels.insertLabel({
              workspaceId: w.id,
              name: q.name,
              toLowerCase: q.name.toLowerCase(),
              color: q.color,
              description: q.description ?? '',
              group_id: q.group_id || null,
            }),
          );
        })
      );
    },
    async updateLabel(ctx, slug, input) {
      const q = parse(schemas.updateLabelSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const current = await labelRow(tx, w.id, q.id);
          const name = q.name ?? String(current.name);
          return labelDTO(
            await tx.labels.updateLabel({
              name,
              toLowerCase: name.toLowerCase(),
              color: q.color ?? current.color,
              description: q.description ?? current.description,
              archived: q.archived ?? current.archived,
              workspaceId: w.id,
              id: q.id,
            }),
          );
        })
      );
    },
    async changeIssueLabels(ctx, slug, input) {
      const q = parse(schemas.changeIssueLabelsSchema, input);
      await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const add = [...new Set(q.add ?? [])];
          const remove = [...new Set(q.remove ?? [])];
          if (remove.some((id) => add.includes(id))) {
            fail('invalid_input', 'Cannot add and remove the same label');
          }
          const added: Row[] = [];
          const groups = new Set<number>();
          for (const id of add) {
            const label = await labelRow(tx, w.id, id);
            if (label.group_id !== null) {
              if (groups.has(Number(label.group_id))) {
                fail('invalid_input', 'Cannot add multiple labels in one group');
              }
              groups.add(Number(label.group_id));
            }
            added.push(label);
          }
          for (const id of remove) {
            await labelRow(tx, w.id, id);
          }
          for (const identifier of new Set(q.identifiers)) {
            const issue = await readIssue(tx, ctx, w, identifier);
            let changed = false;
            for (const id of remove) {
              const removed = await tx.labels.removeIssueLabel({ issueId: issue.id, id });
              changed ||= removed.length > 0;
            }
            for (const label of added) {
              if (
                (await tx.labels.findIssueLabel({ issueId: issue.id, id: label.id })).length
              ) continue;
              if (label.archived) fail('invalid_input', 'Archived labels cannot be newly applied');
              if (label.group_id !== null) {
                await tx.labels.clearExclusiveLabel({
                  issueId: issue.id,
                  group_id: label.group_id,
                });
              }
              await tx.labels.addIssueLabel({ workspaceId: w.id, issueId: issue.id, id: label.id });
              changed = true;
            }
            if (changed) {
              await touchIssue(tx, issue.id);
            }
          }
        })
      );
    },
    async mergeLabels(ctx, slug, input) {
      const q = parse(schemas.mergeLabelsSchema, input);
      await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const source = await labelRow(tx, w.id, q.source_id);
          const target = await labelRow(tx, w.id, q.target_id);
          if (source.group_id !== target.group_id || target.archived) {
            fail('invalid_input', 'Merge target must be active and in the same group');
          }
          const hidden = await tx.labels.hasHiddenIssues({
            id: source.id,
            subject: ctx.identity.subject,
          });
          if (hidden.length) {
            fail('forbidden', 'Cannot merge a label attached to inaccessible issues');
          }
          const affected = await tx.labels.labelIssueIds({ id: source.id });
          await tx.labels.clearLabel({ id: source.id });
          for (const issue of affected) {
            await tx.labels.transferLabel({
              workspaceId: w.id,
              issueId: issue.issue_id,
              id: target.id,
            });
            await touchIssue(tx, issue.issue_id);
          }
          await tx.labels.deleteLabel({ workspaceId: w.id, id: source.id });
        })
      );
    },
  };
}
