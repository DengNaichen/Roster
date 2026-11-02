import { sql } from 'npm:drizzle-orm@0.45.4';
import type { Label } from '../../../../../contracts/catalog.ts';
import { type RequestContext } from '../../../../../contracts/mod.ts';
import { type Executor, type Row, rows } from '../../../platform/database/query.ts';

import { labelDTO } from '../../labels/index.ts';
/** Called only after the core query has applied workspace/private-team visibility. */
export async function hydrateIssueCatalog(
  db: Executor,
  _ctx: RequestContext,
  workspaceId: string,
  issues: Row[],
): Promise<Row[]> {
  if (issues.length === 0) return [];
  const ids = sql.join(issues.map((issue) => sql`${issue.id}::uuid`), sql`, `);
  const projects = await rows(
    db,
    sql`select i.id as issue_id,p.id,p.name,p.emoji from roster.issues i left join roster.projects p on p.id=i.project_id and p.workspace_id=i.workspace_id where i.workspace_id=${workspaceId} and i.id in (${ids})`,
  );
  const labels = await rows(
    db,
    sql`select il.issue_id,l.* from roster.issue_labels il join roster.labels l on l.id=il.label_id where il.workspace_id=${workspaceId} and il.issue_id in (${ids}) order by l.name_key,l.id`,
  );
  const projectByIssue = new Map(projects.map((project) => [String(project.issue_id), project]));
  const labelsByIssue = new Map<string, Label[]>();
  for (const label of labels) {
    const id = String(label.issue_id);
    const entries = labelsByIssue.get(id) ?? [];
    entries.push(labelDTO(label));
    labelsByIssue.set(id, entries);
  }
  return issues.map((issue) => {
    const project = projectByIssue.get(String(issue.id));
    return {
      ...issue,
      project_id: project?.id == null ? null : Number(project.id),
      project: project?.id == null ? null : String(project.name),
      project_emoji: project?.id == null ? '' : String(project.emoji),
      labels: labelsByIssue.get(String(issue.id)) ?? [],
    };
  });
}
