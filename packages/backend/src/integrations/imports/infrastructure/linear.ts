import type { Pool, PoolClient } from 'npm:pg@8.23.1';
import { issueDocumentText } from '../../../../../contracts/mod.ts';
import type { LinearRepository, LinearStore } from '../application/linear-ports.ts';
import { transaction } from './transaction.ts';
function repository(client: PoolClient): LinearRepository {
  return {
    async workspace({ slug }) {
      return client.query('select id from roster.workspaces where slug=$1 for update', [slug]);
    },
    async team({ workspaceId, key }) {
      return client.query(
        'select id,next_number from roster.teams where workspace_id=$1 and key=$2',
        [workspaceId, key],
      );
    },
    async ensureIdentity() {
      return client.query(
        "insert into roster.users(subject,name,email) values('system:linear','Linear import','') on conflict do nothing",
      );
    },
    async insertProject({ workspaceId, name, description, archived }) {
      return client.query(
        'insert into roster.projects(workspace_id,name,description,archived) values($1,$2,$3,$4) on conflict(workspace_id,name) do nothing returning id',
        [workspaceId, name, description, archived],
      );
    },
    async project({ workspaceId, name }) {
      return client.query('select id from roster.projects where workspace_id=$1 and name=$2', [
        workspaceId,
        name,
      ]);
    },
    async linkProject({ workspaceId, projectId, teamId }) {
      return client.query(
        'insert into roster.project_teams(workspace_id,project_id,team_id) values($1,$2,$3) on conflict do nothing',
        [workspaceId, projectId, teamId],
      );
    },
    async insertIssue(
      {
        workspaceId,
        teamId,
        number,
        identifier,
        title,
        document,
        status,
        type,
        priority,
        projectId,
        createdAt,
        updatedAt,
      },
    ) {
      return client.query(
        'insert into roster.issues(workspace_id,team_id,number,identifier,title,document,document_text,status,type,priority,project_id,created_at,updated_at) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13) returning id',
        [
          workspaceId,
          teamId,
          number,
          identifier,
          title,
          JSON.stringify(document),
          issueDocumentText(document),
          status,
          type,
          priority,
          projectId,
          createdAt,
          updatedAt,
        ],
      );
    },
    async insertAudit({ workspaceId, issueId, snapshot, createdAt }) {
      return client.query(
        "insert into roster.audit_events(workspace_id,issue_id,actor_subject,kind,before,after,created_at) values($1,$2,'system:linear','issue.created',null,$3::jsonb,$4)",
        [workspaceId, issueId, snapshot, createdAt],
      );
    },
    async issue({ workspaceId, identifier }) {
      return client.query('select id from roster.issues where workspace_id=$1 and identifier=$2', [
        workspaceId,
        identifier,
      ]);
    },
    async setParent({ parentId, issueId }) {
      return client.query('update roster.issues set parent_id=$1 where id=$2', [parentId, issueId]);
    },
    async insertRelation({ workspaceId, from, kind, to }) {
      return client.query(
        'insert into roster.relations(workspace_id,issue_id,kind,other_id) values($1,$2,$3,$4) on conflict do nothing',
        [workspaceId, from, kind, to],
      );
    },
    async insertComment({ workspaceId, issueId, body, author, createdAt }) {
      return client.query(
        'insert into roster.comments(workspace_id,issue_id,body,author,actor_subject,created_at) values($1,$2,$3,$4,null,$5)',
        [workspaceId, issueId, body, author, createdAt],
      );
    },
    async insertLink({ workspaceId, issueId, title, url }) {
      return client.query(
        'insert into roster.links(workspace_id,issue_id,title,url) values($1,$2,$3,$4)',
        [workspaceId, issueId, title, url],
      );
    },
  };
}
export function createLinearStore(pool: Pool): LinearStore {
  return { transaction: (run) => transaction(pool, (client) => run(repository(client))) };
}
