// Read-only, metadata-only comparison. Never emits business rows or credentials.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [source, target, output, scope = 'all'] = process.argv.slice(2);
if (
  !/^[a-z]{20}$/.test(source ?? '') || !/^[a-z]{20}$/.test(target ?? '') || source === target ||
  !output || !['all', 'roster'].includes(scope)
) {
  throw new Error(
    'Usage: node scripts/migration/verify-projects.mjs SOURCE_REF TARGET_REF OUTPUT.json [all|roster]',
  );
}
function query(project, sql) {
  const result = spawnSync('npx', [
    '--yes',
    'supabase@3.0.0',
    'db',
    'query',
    `--remote=${project}`,
    '--read-only',
    '--output',
    'json',
    sql,
  ], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Read-only query failed for ${project}; no comparison recorded: ${
        result.stderr.slice(0, 500)
      }`,
    );
  }
  const data = JSON.parse(result.stdout);
  if (!Array.isArray(data.rows)) throw new Error('CLI did not return a rows array');
  return data.rows;
}
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
function inventory(project) {
  const [settings] = query(project, "select current_setting('TimeZone') as timezone");
  if (!['UTC', 'Etc/UTC'].includes(settings?.timezone)) {
    throw new Error('Comparison requires UTC sessions');
  }
  const tables = query(
    project,
    `select table_schema,table_name from information_schema.tables
    where table_type='BASE TABLE' and (table_schema='roster'
      ${scope === 'all' ? "or (table_schema='auth' and table_name in ('users','identities'))" : ''}
      or (table_schema='supabase_migrations' and table_name='schema_migrations'))
    order by table_schema,table_name`,
  );
  if (!tables.some((t) => t.table_schema === 'roster')) throw new Error('Missing roster schema');
  const selects = tables.map(({ table_schema, table_name }) => {
    const name = quote(table_schema) + '.' + quote(table_name);
    const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
    return `select ${literal(table_schema)} as schema_name, ${literal(table_name)} as table_name,
      count(*)::text as count,
      encode(sha256(convert_to(coalesce(string_agg(fingerprint,'' order by fingerprint),''),'UTF8')),'hex') as sha256
      from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as fingerprint from ${name} t) rows`;
  });
  return query(project, selects.join(' UNION ALL ') + ' ORDER BY schema_name, table_name');
}
const before = inventory(source);
const after = inventory(target);
const equal = JSON.stringify(before) === JSON.stringify(after);
writeFileSync(
  output,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      source,
      target,
      scope,
      excluded:
        'sessions, storage/config/roles and sequence state need separate validation; roster scope also excludes Auth rows changed by real sign-in',
      snapshot:
        'one aggregate statement per project, not an atomic cross-project snapshot; run under a verified write freeze for cutover acceptance',
      equal,
      before,
      after,
    },
    null,
    2,
  ) + '\n',
  { mode: 0o600 },
);
console.log(
  JSON.stringify({ equal, sourceTables: before.length, targetTables: after.length, output }),
);
if (!equal) process.exitCode = 1;
