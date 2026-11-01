import type { Pool } from 'npm:pg@8.23.1';
import { addLinkSchema } from '../../../contracts/activity.ts';
type Comment = {
  body: string;
  createdAt: string;
  user?: { name: string };
  botActor?: { name: string };
};
type LinearIssue = {
  identifier: string;
  number: number;
  title: string;
  description?: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  trashed?: boolean;
  state: { name: string };
  project?: { name: string };
  parent?: { identifier: string };
  labels: { name: string }[];
  relations: { type: string; relatedIssue: { identifier: string } }[];
  attachments: { sourceType: string; title: string; url: string }[];
  comments: Comment[];
};
type LinearProject = { name: string; description?: string; content?: string; state: string };
const statuses: Record<string, string> = {
  'Triage': 'triage',
  'Backlog': 'backlog',
  'Todo': 'todo',
  'Agent Ready': 'agent_ready',
  'In Progress': 'in_progress',
  'In Review': 'in_review',
  'Done': 'done',
  'Canceled': 'canceled',
};
const types: Record<string, string> = {
  Spec: 'spec',
  Feature: 'feature',
  Bug: 'bug',
  Improvement: 'improvement',
  Chore: 'chore',
};
function kind(issue: LinearIssue) {
  const names = issue.labels.map((l) => l.name);
  for (const n of names) if (!types[n]) throw new Error(`Unmapped label ${n}`);
  if (names.includes('Spec')) return 'spec';
  if (names.length > 1) throw new Error('Multiple type labels');
  return names.length ? types[names[0]] : null;
}
export async function importLinear(
  pool: Pool,
  slug: string,
  key: string,
  issues: LinearIssue[],
  projects: LinearProject[],
) {
  const client = await pool.connect();
  const result = { issues: 0, projects: 0, comments: 0, relations: 0, links: 0 };
  try {
    await client.query('begin');
    const ws = await client.query('select id from roster.workspaces where slug=$1 for update', [
      slug,
    ]);
    if (!ws.rows.length) throw new Error('Workspace not found');
    const wid = ws.rows[0].id;
    const team = (await client.query(
      'select id,next_number from roster.teams where workspace_id=$1 and key=$2',
      [wid, key],
    )).rows[0];
    if (!team) throw new Error('Team not found');
    const selected = issues.filter((i) => !i.trashed).sort((a, b) => a.number - b.number);
    const seen = new Set<number>();
    for (const i of selected) {
      if (
        i.identifier !== `${key}-${i.number}` || !Number.isSafeInteger(i.number) || i.number < 1 ||
        i.number >= team.next_number || seen.has(i.number)
      ) throw new Error(`Invalid or duplicate imported number ${i.identifier}`);
      seen.add(i.number);
      if (!statuses[i.state.name]) throw new Error(`Unmapped status ${i.state.name}`);
      kind(i);
      if (!Number.isFinite(Date.parse(i.createdAt)) || !Number.isFinite(Date.parse(i.updatedAt))) {
        throw new Error('Invalid issue timestamp');
      }
    }
    await client.query(
      "insert into roster.users(subject,name,email) values('system:linear','Linear import','') on conflict do nothing",
    );
    for (const p of projects) {
      const inserted = await client.query(
        'insert into roster.projects(workspace_id,name,description,archived) values($1,$2,$3,$4) on conflict(workspace_id,name) do nothing returning id',
        [
          wid,
          p.name,
          [p.description, p.content].filter(Boolean).join('\n\n'),
          ['completed', 'canceled'].includes(p.state),
        ],
      );
      result.projects += inserted.rowCount ?? 0;
    }
    for (const i of selected) {
      let projectId = null;
      if (i.project) {
        const p =
          (await client.query('select id from roster.projects where workspace_id=$1 and name=$2', [
            wid,
            i.project.name,
          ])).rows[0];
        if (!p) throw new Error('Project not found');
        projectId = p.id;
        await client.query(
          'insert into roster.project_teams(workspace_id,project_id,team_id) values($1,$2,$3) on conflict do nothing',
          [wid, projectId, team.id],
        );
      }
      const issue = (await client.query(
        'insert into roster.issues(workspace_id,team_id,number,identifier,title,description,status,type,priority,project_id,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id',
        [
          wid,
          team.id,
          i.number,
          i.identifier,
          i.title,
          i.description ?? '',
          statuses[i.state.name],
          kind(i),
          i.priority,
          projectId,
          i.createdAt,
          i.updatedAt,
        ],
      )).rows[0];
      await client.query(
        "insert into roster.audit_events(workspace_id,issue_id,actor_subject,kind,before,after,created_at) values($1,$2,'system:linear','issue.created',null,$3::jsonb,$4)",
        [wid, issue.id, JSON.stringify({ status: statuses[i.state.name] }), i.createdAt],
      );
      result.issues++;
    }
    async function lookup(identifier: string) {
      const found = (await client.query(
        'select id from roster.issues where workspace_id=$1 and identifier=$2',
        [wid, identifier],
      )).rows[0];
      if (!found) throw new Error(`Issue not found: ${identifier}`);
      return found.id as string;
    }
    for (const i of selected) {
      const id = await lookup(i.identifier);
      if (i.parent) {
        await client.query('update roster.issues set parent_id=$1 where id=$2', [
          await lookup(i.parent.identifier),
          id,
        ]);
      }
      for (const r of i.relations) {
        if (!['blocks', 'related'].includes(r.type)) throw new Error(`Unmapped relation ${r.type}`);
        let from = id, to = await lookup(r.relatedIssue.identifier);
        if (r.type === 'related' && from > to) [from, to] = [to, from];
        result.relations += (await client.query(
          'insert into roster.relations(workspace_id,issue_id,kind,other_id) values($1,$2,$3,$4) on conflict do nothing',
          [wid, from, r.type, to],
        )).rowCount ?? 0;
      }
      for (const c of [...i.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        const author = c.user?.name ?? c.botActor?.name;
        if (author === undefined) throw new Error('Comment needs an explicit author');
        await client.query(
          'insert into roster.comments(workspace_id,issue_id,body,author,actor_subject,created_at) values($1,$2,$3,$4,null,$5)',
          [wid, id, c.body, author, c.createdAt],
        );
        result.comments++;
      }
      for (const a of i.attachments) {
        if (a.sourceType === 'github') continue;
        const link = addLinkSchema.pick({ title: true, url: true }).parse({
          title: a.title,
          url: a.url,
        });
        await client.query(
          'insert into roster.links(workspace_id,issue_id,title,url) values($1,$2,$3,$4)',
          [wid, id, link.title, link.url],
        );
        result.links++;
      }
    }
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
