/** Local, isolated Postgres setup only. Never accepts a non-test database. */
import { Pool } from 'npm:pg@8.23.1';
export async function prepareTestDatabase(pool: Pool) {
  const connection = await pool.connect();
  try {
    await connection.query('begin');
    const db = await connection.query('select current_database() as name');
    if (!String(db.rows[0].name).endsWith('_test')) {
      throw new Error('Only isolated *_test databases are allowed');
    }
    await connection.query("select pg_advisory_xact_lock(hashtext('roster-test-migrations'))");
    await connection.query(
      "do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$",
    );
    const markers: Record<string, string> = {
      '20261101000000_initial.sql': 'workspaces',
      '20261102000100_catalog.sql': 'projects',
      '20261102000200_cycles_issues.sql': 'cycles',
      '20261102000300_activity.sql': 'comments',
      '20261102000400_github.sql': 'pull_requests',
    };
    for (const [file, table] of Object.entries(markers)) {
      const exists = await connection.query('select to_regclass($1) as name', ['roster.' + table]);
      if (!exists.rows[0].name) {
        await connection.query(
          await Deno.readTextFile(new URL('../../../supabase/migrations/' + file, import.meta.url)),
        );
      }
    }
    await connection.query(
      "do $$ begin if not exists(select 1 from pg_roles where rolname='roster_test_runtime') then create role roster_test_runtime login nosuperuser nocreatedb nocreaterole nobypassrls; end if; end $$",
    );
    await connection.query('grant roster_app to roster_test_runtime');
    await connection.query('commit');
  } catch (error) {
    await connection.query('rollback');
    throw error;
  } finally {
    connection.release();
  }
}
export async function cleanupWorkspace(pool: Pool, id: string) {
  const tables = [
    'github_sync',
    'pull_requests',
    'relations',
    'links',
    'issue_delegations',
    'work_logs',
    'comments',
    'audit_events',
    'issue_labels',
    'issues',
    'cycles',
    'team_members',
    'project_teams',
    'initiative_projects',
    'initiatives',
    'projects',
    'labels',
    'label_groups',
    'workspace_invites',
    'workspace_members',
  ];
  for (const table of tables) {
    const exists = await pool.query('select to_regclass($1) as name', ['roster.' + table]);
    if (!exists.rows[0].name) continue;
    const columns = await pool.query(
      "select 1 from information_schema.columns where table_schema='roster' and table_name=$1 and column_name='workspace_id'",
      [table],
    );
    if (columns.rows.length) {
      await pool.query(`delete from roster.${table} where workspace_id=$1`, [id]);
    }
  }
  await pool.query(
    'delete from roster.team_cycle_settings where team_id in(select id from roster.teams where workspace_id=$1)',
    [id],
  );
  await pool.query('delete from roster.teams where workspace_id=$1', [id]);
  await pool.query('delete from roster.workspaces where id=$1', [id]);
}
