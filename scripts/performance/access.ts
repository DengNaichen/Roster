// Local synthetic permission fixture. Permission changes use normal application authorization.
// delete-fixture simulates external deletion only in a disposable perf-deletion-* workspace;
// there is no public deleteIssue API. It uses the restricted preview role after owner authorization.
import { sql } from 'npm:drizzle-orm@0.45.4';
import { createDatabase } from '../../packages/backend/src/platform/database/client.ts';
import { createService } from '../../packages/backend/src/service.ts';
import type { RequestContext } from '../../packages/contracts/mod.ts';
const [action, slug = 'perf-access'] = Deno.args;
const connection = Deno.env.get('DATABASE_URL');
if (!connection) throw new Error('Use the isolated worktree DATABASE_URL');
const url = new URL(connection);
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  !/^\/roster_wt_[a-f0-9]{12}_preview$/.test(url.pathname) ||
  url.username !== 'roster_preview_runtime' || !/^perf-[a-z0-9-]+$/.test(slug)
) throw new Error('Only isolated local perf-* fixtures with restricted preview role are allowed');
const browser: RequestContext = {
  identity: {
    subject: 'b965fa67-d823-4534-a240-56b88f839dad',
    name: 'Local Developer',
    email: 'developer@roster.local',
  },
};
const owner: RequestContext = {
  identity: {
    subject: '79b6c601-7541-46f9-94d4-01f175d8c35f',
    name: 'Synthetic permission administrator',
    email: 'permission-admin@example.test',
  },
};
const { db, pool } = createDatabase(connection);
const app = createService(db);
try {
  if (action === 'setup') {
    if (!(await app.listWorkspaces(owner)).some((w) => w.slug === slug)) {
      await app.createWorkspace(owner, { slug, name: 'Performance access fixture' });
    }
    if (!(await app.listMembers(owner, slug)).some((m) => m.subject === browser.identity.subject)) {
      const invite = await app.resetInvite(owner, slug);
      await app.joinWorkspace(browser, invite);
    }
    await app.updateMember(owner, slug, {
      subject: browser.identity.subject,
      role: 'member',
      status: 'active',
    });
    if (!(await app.listTeams(owner, slug)).some((t) => t.key === 'PERF')) {
      await app.createTeam(owner, slug, {
        key: 'PERF',
        name: 'Permission fixture',
        private: false,
      });
    }
    await app.updateTeam(owner, slug, 'PERF', { private: false });
    await app.changeTeamMember(owner, slug, 'PERF', {
      subject: browser.identity.subject,
      remove: true,
    });
    if (!(await app.listIssues(owner, slug, { team: 'PERF' })).issues.length) {
      await app.createIssue(owner, slug, {
        team: 'PERF',
        title: 'Permission fixture issue',
        status: 'todo',
        priority: 3,
        document: { lead: 'Isolated permission recovery fixture', sections: [], criteria: [] },
      });
    }
  } else if (action === 'suspend' || action === 'restore') {
    await app.updateMember(owner, slug, {
      subject: browser.identity.subject,
      role: 'member',
      status: action === 'suspend' ? 'suspended' : 'active',
    });
  } else if (action === 'private' || action === 'public') {
    await app.updateTeam(owner, slug, 'PERF', { private: action === 'private' });
  } else if (action === 'delete-fixture' && slug.startsWith('perf-deletion-')) {
    const issues = (await app.listIssues(owner, slug, { team: 'PERF' })).issues;
    if (issues.length !== 1 || issues[0].title !== 'Permission fixture issue') {
      throw new Error('Expected the sole synthetic permission fixture issue');
    }
    const issue = await app.getIssue(owner, slug, issues[0].identifier);
    if (issue.document.lead !== 'Isolated permission recovery fixture') {
      throw new Error('Wrong fixture');
    }
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`delete from roster.audit_events where issue_id=${issue.id} and workspace_id in (select id from roster.workspaces where slug=${slug})`,
      );
      await tx.execute(
        sql`delete from roster.issues where id=${issue.id} and workspace_id in (select id from roster.workspaces where slug=${slug})`,
      );
    });
  } else throw new Error('Use setup, suspend, restore, private, public or delete-fixture');
  console.log(
    JSON.stringify({
      action,
      workspace: slug,
      mode: action === 'delete-fixture'
        ? 'local fixture deletion via restricted role after service owner authorization; no deleteIssue API'
        : 'local application services; restricted database role; fixed test identities',
      at: new Date().toISOString(),
    }),
  );
} finally {
  await pool.end();
}
