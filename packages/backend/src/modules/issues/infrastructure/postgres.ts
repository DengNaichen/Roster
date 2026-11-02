import { sql } from 'npm:drizzle-orm@0.45.4';
import type { Database } from '../../../platform/database/client.ts';
import { one, type Row } from '../../../platform/database/query.ts';
import { createSession } from '../../../platform/database/session.ts';
import { allocateIssueNumber, team, workspace } from '../../access/index.ts';
import { audit } from '../../audit/index.ts';
import { validateIssueCycle } from '../../cycles/index.ts';
import { resolveIssueProject } from '../../planning/index.ts';
import type { IssueDependencies, IssueSnapshot, StoredIssue } from '../application/ports.ts';
import { assignee, createIssueQueries, hydrateCoreIssues, validateParent } from './queries.ts';
import { readIssue } from './read-model.ts';

function snapshot(row: Row): IssueSnapshot {
  return {
    ...row,
    id: String(row.id),
    identifier: String(row.identifier),
    team: String(row.team),
    project_id: row.project_id == null ? null : Number(row.project_id),
    cycle_id: row.cycle_id == null ? null : Number(row.cycle_id),
    parent_id: row.parent_id == null ? null : String(row.parent_id),
    assignee_subject: row.assignee_subject == null ? null : String(row.assignee_subject),
  };
}
export function createPostgresIssueDependencies(db: Database): IssueDependencies {
  return {
    ...createIssueQueries(db),
    transaction: (run) =>
      db.transaction((tx) => {
        const session = createSession(tx);
        return run({
          workspace: async (ctx, slug) =>
            await workspace(session, ctx, slug, true) as { id: string },
          team: async (ctx, w, key) =>
            await team(session, ctx, w, key) as { id: string; private: boolean },
          read: async (ctx, w, id) => snapshot(await readIssue(tx, ctx, w, id)),
          assignee: (w, t, subject) => assignee(tx, w, t, subject),
          project: (ctx, w, t, input, current) =>
            resolveIssueProject(session, ctx, w.id, t.id, input, current),
          cycle: (t, input, current, now) => validateIssueCycle(session, t, input, current, now),
          parent: async (ctx, w, input, current) => {
            const id = await validateParent(tx, ctx, w, input, current);
            return id == null ? null : String(id);
          },
          nextNumber: (t) => allocateIssueNumber(session, t.id),
          insert: async (w, t, number, input, refs) => {
            const row = await one(
              tx,
              sql`insert into roster.issues(workspace_id,team_id,number,identifier,title,description,status,type,priority,assignee_subject,project_id,cycle_id,parent_id) values(${w.id},${t.id},${number},${
                input.team + '-' + number
              },${input.title.trim()},${input.description ?? ''},${input.status ?? 'triage'},${
                input.type ?? null
              },${
                input.priority ?? 0
              },${refs.assignee},${refs.project},${refs.cycle},${refs.parent}) returning *`,
            );
            // Preserve the exact inserted row in audit; read() supplies the joined team for output.
            return {
              ...row,
              id: String(row.id),
              identifier: String(row.identifier),
            } satisfies StoredIssue;
          },
          update: async (r, input, refs) => {
            await tx.execute(
              sql`update roster.issues set title=${input.title?.trim() ?? r.title},description=${
                input.description ?? r.description
              },status=${input.status ?? r.status},type=${
                input.type === undefined ? r.type : input.type
              },priority=${
                input.priority ?? r.priority
              },assignee_subject=${refs.assignee},project_id=${refs.project},cycle_id=${refs.cycle},parent_id=${refs.parent},updated_at=clock_timestamp() where id=${r.id}`,
            );
          },
          audit: (ctx, w, kind, before, after) =>
            audit(session, ctx, w, kind, before, after, after.id),
          output: async (ctx, w, r) => (await hydrateCoreIssues(tx, ctx, w, [r]))[0],
        });
      }),
  };
}
