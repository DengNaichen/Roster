import { createDatabase } from '../../packages/backend/src/platform/database/client.ts';
import { createService } from '../../packages/backend/src/service.ts';
import type { RequestContext } from '../../packages/contracts/mod.ts';
const connection = Deno.env.get('DATABASE_URL');
if (!connection) throw new Error('DATABASE_URL required');
const url = new URL(connection);
if (
  url.hostname !== '127.0.0.1' || !/^\/roster_wt_[a-f0-9]{12}_preview$/.test(url.pathname) ||
  url.username !== 'roster_preview_runtime'
) throw new Error('Use only the restricted worktree preview database');
const slug = 'perf-joined-v1';
const ctx: RequestContext = {
  identity: {
    subject: 'b965fa67-d823-4534-a240-56b88f839dad',
    name: 'Local Developer',
    email: 'developer@roster.local',
  },
};
const { db, pool } = createDatabase(connection);
const app = createService(db);
try {
  const project = (await app.listProjects(ctx, slug)).find((p) => p.name === 'Measured project') ??
    await app.createProject(ctx, slug, { name: 'Measured project', teams: ['PERF'], emoji: '📦' });
  const group = (await app.listLabelGroups(ctx, slug)).find((g) => g.name === 'Measured group') ??
    await app.saveLabelGroup(ctx, slug, { name: 'Measured group' });
  const labels = await app.listLabels(ctx, slug);
  const ids: number[] = [];
  for (const name of ['Measured standalone', 'Measured alpha']) {
    const groupId = name.endsWith('alpha') ? group.id : 0;
    const label = labels.find((l) => l.name === name) ??
      await app.createLabel(ctx, slug, { name, group_id: groupId, color: '#778899' });
    if (label.group_id !== groupId) {
      throw new Error('Existing fixture label has a different immutable group');
    }
    ids.push(label.id);
  }

  const issues = (await app.listIssues(ctx, slug, { team: 'PERF', limit: -1 })).issues;
  if (issues.length !== 50) throw new Error('Seed the 50-row v2 probe fixture first');
  for (const issue of issues) {
    const number = Number(issue.identifier.slice(5));
    const parent = number === 1 || (number >= 9 && number <= 24)
      ? 'PERF-2'
      : number >= 3 && number <= 8
      ? 'PERF-1'
      : undefined;
    if (issue.project_id !== project.id || (parent && issue.parent !== parent)) {
      await app.updateIssue(ctx, slug, issue.identifier, {
        project_id: project.id,
        ...(parent ? { parent } : {}),
      });
    }
  }
  await app.changeIssueLabels(ctx, slug, {
    identifiers: issues.map((i) => i.identifier),
    add: ids,
    remove: [],
  });
  for (let i = 9; i <= 20; i++) {
    await app.addRelation(ctx, slug, {
      identifier: 'PERF-1',
      kind: i <= 14 ? 'blocks' : 'related',
      other: `PERF-${i}`,
    });
  }
  for (let i = 21; i <= 24; i++) {
    await app.addRelation(ctx, slug, { identifier: `PERF-${i}`, kind: 'blocks', other: 'PERF-1' });
  }
  const detail = await app.getIssue(ctx, slug, 'PERF-1');
  if (!detail.comments.length) {
    await app.addComment(ctx, slug, { identifier: 'PERF-1', body: 'Measured human comment' });
  }
  if (!detail.links.length) {
    await app.addLink(ctx, slug, {
      identifier: 'PERF-1',
      title: 'Measured link',
      url: 'https://example.test/performance',
    });
  }
  if (!detail.work_log_count) {
    await app.addWorkLog(ctx, slug, {
      identifier: 'PERF-1',
      kind: 'decision',
      summary: 'Measured decision',
      body: 'Synthetic decision body',
    });
    await app.addWorkLog(ctx, slug, {
      identifier: 'PERF-1',
      kind: 'progress',
      summary: 'Measured progress',
      body: 'Synthetic progress body',
    });
  }
  if (!detail.assignee) {
    await app.updateIssue(ctx, slug, 'PERF-1', { assignee: ctx.identity.subject });
  }
  if (!detail.delegations.length) {
    await app.delegateIssue(ctx, slug, {
      identifier: 'PERF-1',
      client_context: {
        agent: 'codex',
        session_id: 'sql-performance-fixture',
        hostname: 'local-fixture',
      },
    });
  }
  console.log(
    JSON.stringify({
      workspace: slug,
      issues: 50,
      labelsPerIssue: 2,
      children: 6,
      blocks: 6,
      blockedBy: 4,
      related: 6,
      mode: 'normal application services; restricted local role',
    }),
  );
} finally {
  await pool.end();
}
