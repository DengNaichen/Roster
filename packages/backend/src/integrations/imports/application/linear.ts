import { addLinkSchema } from '../../../../../contracts/activity.ts';
import { documentFromDescription } from '../../../modules/issues/index.ts';
import type { LinearStore } from './linear-ports.ts';
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
  store: LinearStore,
  slug: string,
  key: string,
  issues: LinearIssue[],
  projects: LinearProject[],
) {
  const result = { issues: 0, projects: 0, comments: 0, relations: 0, links: 0 };
  return store.transaction(async (repository) => {
    const ws = await repository.workspace({ slug: slug });
    if (!ws.rows.length) throw new Error('Workspace not found');
    const wid = ws.rows[0].id;
    const team = (await repository.team({ workspaceId: wid, key: key })).rows[0];
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
    await repository.ensureIdentity();
    for (const p of projects) {
      const inserted = await repository.insertProject({
        workspaceId: wid,
        name: p.name,
        description: [p.description, p.content].filter(Boolean).join('\n\n'),
        archived: ['completed', 'canceled'].includes(p.state),
      });
      result.projects += inserted.rowCount ?? 0;
    }
    for (const i of selected) {
      let projectId = null;
      if (i.project) {
        const p = (await repository.project({ workspaceId: wid, name: i.project.name })).rows[0];
        if (!p) throw new Error('Project not found');
        projectId = p.id;
        await repository.linkProject({ workspaceId: wid, projectId: projectId, teamId: team.id });
      }
      const issue = (await repository.insertIssue({
        workspaceId: wid,
        teamId: team.id,
        number: i.number,
        identifier: i.identifier,
        title: i.title,
        document: documentFromDescription(i.description ?? ''),
        status: statuses[i.state.name],
        type: kind(i),
        priority: i.priority,
        projectId: projectId,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      })).rows[0];
      await repository.insertAudit({
        workspaceId: wid,
        issueId: issue.id,
        snapshot: JSON.stringify({ status: statuses[i.state.name] }),
        createdAt: i.createdAt,
      });
      result.issues++;
    }
    async function lookup(identifier: string) {
      const found = (await repository.issue({ workspaceId: wid, identifier: identifier })).rows[0];
      if (!found) throw new Error(`Issue not found: ${identifier}`);
      return found.id as string;
    }
    for (const i of selected) {
      const id = await lookup(i.identifier);
      if (i.parent) {
        await repository.setParent({ parentId: await lookup(i.parent.identifier), issueId: id });
      }
      for (const r of i.relations) {
        if (!['blocks', 'related'].includes(r.type)) throw new Error(`Unmapped relation ${r.type}`);
        let from = id, to = await lookup(r.relatedIssue.identifier);
        if (r.type === 'related' && from > to) [from, to] = [to, from];
        result.relations +=
          (await repository.insertRelation({ workspaceId: wid, from: from, kind: r.type, to: to }))
            .rowCount ?? 0;
      }
      for (const c of [...i.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        const author = c.user?.name ?? c.botActor?.name;
        if (author === undefined) throw new Error('Comment needs an explicit author');
        await repository.insertComment({
          workspaceId: wid,
          issueId: id,
          body: c.body,
          author: author,
          createdAt: c.createdAt,
        });
        result.comments++;
      }
      for (const a of i.attachments) {
        if (a.sourceType === 'github') continue;
        const link = addLinkSchema.pick({ title: true, url: true }).parse({
          title: a.title,
          url: a.url,
        });
        await repository.insertLink({
          workspaceId: wid,
          issueId: id,
          title: link.title,
          url: link.url,
        });
        result.links++;
      }
    }
    return result;
  });
}
