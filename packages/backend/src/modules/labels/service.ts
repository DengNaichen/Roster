import { type SQL, sql } from 'npm:drizzle-orm@0.45.4';
import { z } from 'zod';
import type { Label, LabelFilterInput } from '../../../../contracts/catalog.ts';
import * as schemas from '../../../../contracts/catalog.ts';
import type { CatalogService } from '../../application/catalog.ts';
import type { Database } from '../../platform/database/client.ts';
import { type Executor, one, type Row, rows } from '../../platform/database/query.ts';
import { fail } from '../../platform/errors/validation.ts';
import { visible, workspace } from '../access/index.ts';
import { readIssue } from '../issues/index.ts';

import { translate } from '../../platform/database/catalog-errors.ts';
import { parse } from '../../platform/errors/parse.ts';
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
async function labelRow(db: Executor, workspaceId: unknown, id: number): Promise<Row> {
  const row = (await rows(
    db,
    sql`select * from roster.labels where workspace_id=${workspaceId} and id=${id}`,
  ))[0];
  if (!row) fail('not_found', 'Label not found');
  return row;
}

export async function buildLabelFilter(
  db: Executor,
  workspaceId: string,
  input: LabelFilterInput,
): Promise<SQL> {
  const parsed = parse(
    z.strictObject({
      label_mode: z.enum(['any', 'all', 'none', 'unlabeled']).optional(),
      label_ids: z.array(z.number().int().positive()).optional(),
      label_group_ids: z.array(z.number().int().positive()).optional(),
    }),
    input,
  );
  const mode = parsed.label_mode ?? 'any';
  if (mode === 'unlabeled') {
    if ((parsed.label_ids?.length ?? 0) + (parsed.label_group_ids?.length ?? 0) > 0) {
      fail('invalid_input', 'Unlabeled mode cannot include label selections');
    }
    return sql`not exists(select 1 from roster.issue_labels il where il.issue_id=i.id)`;
  }
  const predicates: SQL[] = [];
  for (const id of parsed.label_ids ?? []) {
    await labelRow(db, workspaceId, id);
    predicates.push(
      sql`exists(select 1 from roster.issue_labels il where il.issue_id=i.id and il.label_id=${id})`,
    );
  }
  for (const id of parsed.label_group_ids ?? []) {
    if (
      !(await rows(
        db,
        sql`select 1 from roster.label_groups where workspace_id=${workspaceId} and id=${id}`,
      )).length
    ) fail('not_found', 'Label group not found');
    predicates.push(
      sql`exists(select 1 from roster.issue_labels il join roster.labels l on l.id=il.label_id where il.issue_id=i.id and l.group_id=${id})`,
    );
  }
  if (predicates.length === 0) return sql`true`;
  const combined = sql`(${sql.join(predicates, mode === 'all' ? sql` and ` : sql` or `)})`;
  return mode === 'none' ? sql`not ${combined}` : combined;
}

export function createLabelService(
  db: Database,
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
      return (await rows(
        db,
        sql`select * from roster.labels where workspace_id=${w.id} and (${
          q.include_archived ?? false
        } or not archived) order by name_key,id`,
      )).map(labelDTO);
    },
    async listLabelGroups(ctx, slug, input = {}) {
      parse(schemas.listLabelGroupsSchema, input);
      const w = await workspace(db, ctx, slug);
      return (await rows(
        db,
        sql`select id,name from roster.label_groups where workspace_id=${w.id} order by name_key,id`,
      )).map((row) => ({ id: Number(row.id), name: String(row.name) }));
    },
    async saveLabelGroup(ctx, slug, input) {
      const q = parse(schemas.saveLabelGroupSchema, input);
      return await translate(() =>
        db.transaction(async (tx) => {
          const w = await workspace(tx, ctx, slug, true);
          const row = !q.id
            ? await one(
              tx,
              sql`insert into roster.label_groups(workspace_id,name,name_key) values(${w.id},${q.name},${q.name.toLowerCase()}) returning id,name`,
            )
            : await one(
              tx,
              sql`update roster.label_groups set name=${q.name},name_key=${q.name.toLowerCase()} where workspace_id=${w.id} and id=${q.id} returning id,name`,
            );
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
            !(await rows(
              tx,
              sql`select 1 from roster.label_groups where workspace_id=${w.id} and id=${q.group_id}`,
            )).length
          ) fail('not_found', 'Label group not found');
          return labelDTO(
            await one(
              tx,
              sql`insert into roster.labels(workspace_id,name,name_key,color,description,group_id) values(${w.id},${q.name},${q.name.toLowerCase()},${q.color},${
                q.description ?? ''
              },${q.group_id || null}) returning *`,
            ),
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
            await one(
              tx,
              sql`update roster.labels set name=${name},name_key=${name.toLowerCase()},color=${
                q.color ?? current.color
              },description=${q.description ?? current.description},archived=${
                q.archived ?? current.archived
              } where workspace_id=${w.id} and id=${q.id} returning *`,
            ),
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
              const removed = await rows(
                tx,
                sql`delete from roster.issue_labels where issue_id=${issue.id} and label_id=${id} returning label_id`,
              );
              changed ||= removed.length > 0;
            }
            for (const label of added) {
              if (
                (await rows(
                  tx,
                  sql`select 1 from roster.issue_labels where issue_id=${issue.id} and label_id=${label.id}`,
                )).length
              ) continue;
              if (label.archived) fail('invalid_input', 'Archived labels cannot be newly applied');
              if (label.group_id !== null) {
                await tx.execute(
                  sql`delete from roster.issue_labels il using roster.labels l where il.label_id=l.id and il.issue_id=${issue.id} and l.group_id=${label.group_id}`,
                );
              }
              await tx.execute(
                sql`insert into roster.issue_labels(workspace_id,issue_id,label_id) values(${w.id},${issue.id},${label.id})`,
              );
              changed = true;
            }
            if (changed) {
              await tx.execute(
                sql`update roster.issues set updated_at=clock_timestamp() where id=${issue.id}`,
              );
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
          const hidden = await rows(
            tx,
            sql`select 1 from roster.issue_labels il join roster.issues i on i.id=il.issue_id join roster.teams t on t.id=i.team_id where il.label_id=${source.id} and not ${
              visible(ctx.identity.subject)
            } limit 1`,
          );
          if (hidden.length) {
            fail('forbidden', 'Cannot merge a label attached to inaccessible issues');
          }
          const affected = await rows(
            tx,
            sql`select issue_id from roster.issue_labels where label_id=${source.id}`,
          );
          await tx.execute(sql`delete from roster.issue_labels where label_id=${source.id}`);
          for (const issue of affected) {
            await tx.execute(
              sql`insert into roster.issue_labels(workspace_id,issue_id,label_id) values(${w.id},${issue.issue_id},${target.id}) on conflict do nothing`,
            );
            await tx.execute(
              sql`update roster.issues set updated_at=clock_timestamp() where id=${issue.issue_id}`,
            );
          }
          await tx.execute(
            sql`delete from roster.labels where workspace_id=${w.id} and id=${source.id}`,
          );
        })
      );
    },
  };
}
