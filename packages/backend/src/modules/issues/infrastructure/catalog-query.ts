import { sql } from 'npm:drizzle-orm@0.45.4';
import type { RequestContext } from '../../../../../contracts/mod.ts';
import { type Executor, type Row, rows } from '../../../platform/database/query.ts';
import { visible } from '../../access/postgres.ts';
import { labelDTO } from '../../labels/index.ts';
/** Called only after the core query has applied workspace/private-team visibility. */
export async function hydrateIssueCatalog(
  db: Executor,
  ctx: RequestContext,
  workspaceId: string,
  issues: Row[],
): Promise<Row[]> {
  if (!issues.length) return [];
  const ids = sql.param([...new Set(issues.map((issue) => String(issue.id)))]);
  // Most rows have neither reference. Reuse known nulls and only fetch their labels.
  // This retains one SQL stage without paying for empty project/parent joins.
  if (issues.every((issue) => issue.project_id === null && issue.parent_id === null)) {
    const labels = await rows(
      db,
      sql`select il.issue_id,l.* from roster.issue_labels il join roster.labels l on l.id=il.label_id where il.workspace_id=${workspaceId} and il.issue_id=any(${ids}::uuid[]) order by l.name_key,l.id`,
    );
    const byIssue = new Map<string, ReturnType<typeof labelDTO>[]>();
    for (const label of labels) {
      const entries = byIssue.get(String(label.issue_id)) ?? [];
      entries.push(labelDTO(label));
      byIssue.set(String(label.issue_id), entries);
    }
    return issues.map((issue) => ({
      ...issue,
      project_id: null,
      project: null,
      project_emoji: '',
      parent: null,
      labels: byIssue.get(String(issue.id)) ?? [],
    }));
  }
  const catalog = await rows(
    db,
    sql`
    with labels as (
      select il.issue_id,jsonb_agg(to_jsonb(l) order by l.name_key,l.id) as labels
      from roster.issue_labels il join roster.labels l on l.id=il.label_id
      where il.workspace_id=${workspaceId} and il.issue_id=any(${ids}::uuid[])
      group by il.issue_id
    )
    select i.id as issue_id,p.id as project_id,p.name as project,p.emoji as project_emoji,
           coalesce(labels.labels,'[]'::jsonb) as labels,parents.identifier as parent
    from roster.issues i
    left join roster.projects p on p.id=i.project_id and p.workspace_id=i.workspace_id
    left join labels on labels.issue_id=i.id
    left join (
      select pi.id,pi.workspace_id,pi.identifier from roster.issues pi join roster.teams t on t.id=pi.team_id
      where ${visible(ctx.identity.subject)}
    ) parents on parents.id=i.parent_id and parents.workspace_id=i.workspace_id
    where i.workspace_id=${workspaceId} and i.id=any(${ids}::uuid[])
  `,
  );
  const byId = new Map(catalog.map((row) => [String(row.issue_id), row]));
  return issues.map((issue) => {
    const row = byId.get(String(issue.id));
    return {
      ...issue,
      project_id: row?.project_id == null ? null : Number(row.project_id),
      project: row?.project_id == null ? null : String(row.project),
      project_emoji: row?.project_id == null ? '' : String(row.project_emoji),
      labels: ((row?.labels ?? []) as Row[]).map(labelDTO),
      parent: row?.parent == null ? null : String(row.parent),
    };
  });
}
