import { type SQL, sql } from 'npm:drizzle-orm@0.45.4';
import { z } from 'zod';
import type { LabelFilterInput } from '../../../../../contracts/catalog.ts';
import { type Executor, type Row, rows } from '../../../platform/database/query.ts';
import { fail } from '../../../platform/errors/validation.ts';

import { parse } from '../../../platform/errors/parse.ts';
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
