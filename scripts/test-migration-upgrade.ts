/** Real Supabase CLI regression for late-merged migrations. Uses disposable local databases. */
import { Pool } from 'npm:pg@8.23.1';

const adminUrl = new URL(Deno.env.get('ROSTER_MIGRATION_TEST_ADMIN_URL') ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname)) {
  throw new Error('Migration regression requires a local Postgres admin connection');
}
// The isolated local/CI Postgres service has no TLS endpoint.
adminUrl.searchParams.set('sslmode', 'disable');
const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const late = '20261117042051_github_webhook_inbox.sql';
const directory = new URL('../supabase/migrations/', import.meta.url);
const files = [];
for await (const entry of Deno.readDir(directory)) {
  if (entry.isFile && entry.name.endsWith('.sql')) files.push(entry.name);
}
files.sort();
const baseRef = Deno.env.get('ROSTER_MIGRATION_BASE_REF');
let baseFiles: string[] | undefined;
if (baseRef) {
  if (!/^[a-f0-9]{40}$/.test(baseRef)) throw new Error('Migration base must be a full commit SHA');
  const listing = await new Deno.Command('git', {
    args: ['ls-tree', '--name-only', `${baseRef}:supabase/migrations`],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  requireSuccess(listing);
  baseFiles = new TextDecoder().decode(listing.stdout).trim().split('\n').filter((file) =>
    file.endsWith('.sql')
  );
  for (const file of baseFiles) {
    const original = await new Deno.Command('git', {
      args: ['show', `${baseRef}:supabase/migrations/${file}`],
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    requireSuccess(original);
    if (
      !files.includes(file) ||
      new TextDecoder().decode(original.stdout) !==
        await Deno.readTextFile(new URL(file, directory))
    ) {
      throw new Error(`Previously committed migration changed or disappeared: ${file}`);
    }
  }
}
const temporary = await Deno.makeTempDir({ prefix: 'roster-migration-' });
const created: string[] = [];
const pools: Pool[] = [];
const encoder = new TextEncoder();
async function push(url: string, ...flags: string[]) {
  return await new Deno.Command('supabase', {
    args: [
      'db',
      'push',
      '--workdir',
      temporary,
      `--remote=${url}`,
      '--yes',
      '--skip-vault',
      ...flags,
    ],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
}
function requireSuccess(result: Deno.CommandOutput) {
  if (!result.success) {
    throw new Error(
      new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
    );
  }
}
try {
  await Deno.mkdir(`${temporary}/supabase/migrations`, { recursive: true });
  await Deno.writeTextFile(
    `${temporary}/supabase/config.toml`,
    'project_id = "roster-migration-test"\n',
  );
  // Prerequisites are cluster roles, just as in the delivery workflow's isolated Postgres service.
  await admin.query(
    "do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$",
  );
  const snapshots: string[] = [];
  for (const scenario of baseFiles ? ['upgrade', 'base', 'fresh'] : ['upgrade', 'fresh']) {
    const initial = scenario === 'upgrade'
      ? files.filter((file) => file !== late && file.split('_')[0] <= '20261117090655')
      : scenario === 'base' && baseFiles
      ? baseFiles
      : files;
    for (const entry of Deno.readDirSync(`${temporary}/supabase/migrations`)) {
      await Deno.remove(`${temporary}/supabase/migrations/${entry.name}`);
    }
    for (const file of initial) {
      await Deno.copyFile(new URL(file, directory), `${temporary}/supabase/migrations/${file}`);
    }
    const name = `roster_${scenario}_${crypto.randomUUID().replaceAll('-', '')}_test`;
    await admin.query(`create database "${name}"`);
    created.push(name);
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    const db = new Pool({ connectionString: url.toString(), max: 1 });
    pools.push(db);
    if (scenario === 'upgrade') {
      // Mirrors main before #52: both later OAuth migrations have already been applied.
      requireSuccess(await push(url.toString()));
      await db.query(
        "insert into roster.workspaces(id,slug,name) values('00000000-0000-4000-8000-000000000052','upgrade-test','Upgrade test')",
      );
      await db.query(
        "insert into roster.github_sync(workspace_id,repo,requested_at) values('00000000-0000-4000-8000-000000000052','owner/repo',now())",
      );
    }
    if (scenario !== 'fresh') {
      if (scenario === 'base') requireSuccess(await push(url.toString()));
      for (const file of files) {
        await Deno.copyFile(new URL(file, directory), `${temporary}/supabase/migrations/${file}`);
      }
      if (scenario === 'upgrade') {
        const rejected = await push(url.toString(), '--dry-run');
        const error = new TextDecoder().decode(rejected.stdout) +
          new TextDecoder().decode(rejected.stderr);
        if (rejected.success || !error.includes('--include-all')) {
          throw new Error(`Expected the original out-of-order migration failure: ${error}`);
        }
      }
      const plan = await push(url.toString(), '--include-all', '--dry-run');
      requireSuccess(plan);
      const planText = new TextDecoder().decode(plan.stdout) +
        new TextDecoder().decode(plan.stderr);
      const planned = [...new Set(planText.match(/\d{14}_[a-zA-Z0-9_]+\.sql/g) ?? [])].sort();
      const expected = files.filter((file) => !initial.includes(file));
      if (JSON.stringify(planned) !== JSON.stringify(expected)) {
        throw new Error(
          `Unexpected pending plan: ${JSON.stringify(planned)}; expected ${
            JSON.stringify(expected)
          }`,
        );
      }
    }
    requireSuccess(await push(url.toString(), '--include-all'));
    // Repeating the actual command must skip the already applied, non-idempotent DDL.
    requireSuccess(await push(url.toString(), '--include-all'));
    const history = await db.query(
      'select version from supabase_migrations.schema_migrations order by version',
    );
    if (
      JSON.stringify(history.rows.map((row: { version: string }) => row.version)) !==
        JSON.stringify(files.map((file) => file.split('_')[0]))
    ) {
      throw new Error('Applied migration history differs from repository migrations');
    }
    const definitions = [];
    for (
      const query of [
        "select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='roster' order by table_name,ordinal_position",
        "select tablename,indexname,indexdef from pg_indexes where schemaname='roster' order by tablename,indexname",
        "select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition from pg_constraint where connamespace='roster'::regnamespace order by relation,conname",
        "select table_name,grantee,privilege_type,is_grantable from information_schema.role_table_grants where table_schema='roster' order by table_name,grantee,privilege_type,is_grantable",
        "select p.oid::regprocedure::text as signature,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='roster' order by signature",
        "select tgrelid::regclass::text as relation,tgname,pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal and tgrelid in(select oid from pg_class where relnamespace='roster'::regnamespace) order by relation,tgname",
        "select nspacl::text from pg_namespace where nspname='roster'",
      ]
    ) definitions.push((await db.query(query)).rows);
    const snapshot = JSON.stringify(definitions);
    snapshots.push(snapshot);
    await Deno.writeFile(`${temporary}/${scenario}.json`, encoder.encode(snapshot));
    if (scenario === 'upgrade') {
      const existing = await db.query(
        "select repo,failures,binding_key from roster.github_sync where repo='owner/repo'",
      );
      if (
        existing.rows.length !== 1 || existing.rows[0].failures !== 0 ||
        existing.rows[0].binding_key !== null
      ) {
        throw new Error('Existing GitHub sync row was not preserved with new defaults');
      }
    }
    console.log(`${scenario}: CLI push, retry, schema and migration history verified`);
  }
  if (!snapshots.every((snapshot) => snapshot === snapshots[0])) {
    throw new Error('Fresh and upgraded schemas differ');
  }
  console.log('Fresh and late-migration upgrade schemas match');
} finally {
  for (const pool of pools) await pool.end();
  for (const name of created) await admin.query(`drop database "${name}"`);
  await admin.end();
  await Deno.remove(temporary, { recursive: true });
}
