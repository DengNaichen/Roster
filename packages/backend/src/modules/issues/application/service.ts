import type { Service } from '../../../application/mod.ts';

import { text } from '../../../platform/errors/validation.ts';
import { validateIssue } from '../domain/rules.ts';
import type { IssueDependencies } from './ports.ts';
export type IssueService = Pick<Service, 'listIssues' | 'getIssue' | 'createIssue' | 'updateIssue'>;

export function createIssueService(
  deps: IssueDependencies,
  options: { now?: () => Date } = {},
): IssueService {
  const clock = options.now ?? (() => new Date());
  return {
    listIssues: (ctx, slug, input) => deps.listIssues(ctx, slug, input),
    getIssue: (ctx, slug, id) => deps.getIssue(ctx, slug, id),
    async createIssue(ctx, slug, input) {
      validateIssue(input);
      text(input.title, 'Title');
      return deps.transaction(async (session) => {
        const w = await session.workspace(ctx, slug);
        const t = await session.team(ctx, w, input.team);
        const assignee = await session.assignee(w, t, input.assignee);
        const project = await session.project(ctx, w, t, input, null);
        const cycle = await session.cycle(t, input.cycle_id, null, clock());
        const parent = await session.parent(ctx, w, input.parent, null);
        const number = await session.nextNumber(t);
        const r = await session.insert(w, t, number, input, { assignee, project, cycle, parent });
        await session.audit(ctx, w, 'issue.created', null, r);
        return session.output(ctx, w, await session.read(ctx, w, r.identifier));
      });
    },
    async updateIssue(ctx, slug, identifier, input) {
      validateIssue(input);
      return deps.transaction(async (session) => {
        const w = await session.workspace(ctx, slug);
        const r = await session.read(ctx, w, identifier);
        const t = await session.team(ctx, w, r.team);
        const project = await session.project(ctx, w, t, input, r.project_id);
        const cycle = await session.cycle(t, input.cycle_id, r.cycle_id, clock());
        const parent = await session.parent(ctx, w, input.parent, r);
        const assignee = input.assignee === undefined
          ? r.assignee_subject
          : await session.assignee(w, t, input.assignee);
        await session.update(r, input, { assignee, project, cycle, parent });
        const after = await session.read(ctx, w, identifier);
        await session.audit(ctx, w, 'issue.updated', r, after);
        return session.output(ctx, w, after);
      });
    },
  };
}
