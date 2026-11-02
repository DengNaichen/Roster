import type { Pool, PoolClient } from 'npm:pg@8.23.1';
import type { Row } from '../../../application/records.ts';
import type { SnapshotRepository, SnapshotStore } from '../application/ports.ts';
import { transaction } from './transaction.ts';
const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
function repository(client: PoolClient): SnapshotRepository {
  let metadata:
    | Promise<Map<string, Map<string, { data_type: string; is_identity: string }>>>
    | undefined;
  function schema() {
    return metadata ??= client.query(
      "select table_name,column_name,data_type,is_identity from information_schema.columns where table_schema='roster'",
    ).then(
      (
        result: {
          rows: {
            table_name: string;
            column_name: string;
            data_type: string;
            is_identity: string;
          }[];
        },
      ) => {
        const tables = new Map<string, Map<string, { data_type: string; is_identity: string }>>();
        for (const column of result.rows) {
          if (!tables.has(column.table_name)) tables.set(column.table_name, new Map());
          tables.get(column.table_name)!.set(column.column_name, column);
        }
        return tables;
      },
    );
  }
  return {
    async lock() {
      await client.query('select pg_advisory_xact_lock(728615824)');
    },
    async hasWorkspaces() {
      return Boolean(
        (await client.query('select count(*)::int as n from roster.workspaces')).rows[0].n,
      );
    },
    async insert(table: string, row: Row) {
      const allowed = (await schema()).get(table);
      if (!allowed) throw new Error(`Apply migrations before import: ${table}`);
      const keys = Object.keys(row).filter((key) => allowed.has(key));
      const values = keys.map((key) =>
        allowed.get(key)!.data_type === 'boolean' ? Boolean(row[key]) : row[key]
      );
      await client.query(
        `insert into roster.${identifier(table)} (${
          keys.map(identifier).join(',')
        }) overriding system value values(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
        values,
      );
    },
    async ensureSystemIdentity() {
      await client.query(
        "insert into roster.users(subject,name,email) values('system:legacy','Imported system','') on conflict do nothing",
      );
    },
    async setParent(parentId, issueId) {
      await client.query('update roster.issues set parent_id=$1 where id=$2', [parentId, issueId]);
    },
    async ensureOwner(subject, name, email) {
      await client.query(
        'insert into roster.users(subject,name,email) values($1,$2,$3) on conflict do nothing',
        [subject, name, email],
      );
    },
    async ensureAdministrator(workspaceId, subject) {
      await client.query(
        "insert into roster.workspace_members(workspace_id,subject,role,status) select $1,$2,'admin','active' where not exists(select 1 from roster.workspace_members where workspace_id=$1 and role='admin' and status='active') on conflict(workspace_id,subject) do update set role='admin',status='active'",
        [workspaceId, subject],
      );
    },
    async inaccessibleWorkspaces() {
      return (await client.query(
        "select slug from roster.workspaces w where not exists(select 1 from roster.workspace_members m where m.workspace_id=w.id and role='admin' and status='active')",
      )).rows.length > 0;
    },
    async collidingNumbers() {
      return (await client.query(
        'select key from roster.teams t where next_number <= coalesce((select max(number) from roster.issues where team_id=t.id),0)',
      )).rows.length > 0;
    },
    async advanceSequences() {
      for (const [table, columns] of await schema()) {
        if (columns.get('id')?.is_identity === 'YES') {
          await client.query(
            `select setval(pg_get_serial_sequence($1,'id'),greatest(coalesce((select max(id) from roster.${
              identifier(table)
            }),0),1),(select count(*)>0 from roster.${identifier(table)}))`,
            ['roster.' + identifier(table)],
          );
        }
      }
    },
  };
}
export function createSnapshotStore(pool: Pool): SnapshotStore {
  return { transaction: (run) => transaction(pool, (client) => run(repository(client))) };
}
