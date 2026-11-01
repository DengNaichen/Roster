import { Pool } from 'npm:pg@8.23.1';

// Local migration runner. Hosted deployments use `supabase db push` instead.
const url = Deno.env.get('DATABASE_URL');
if (!url) throw new Error('DATABASE_URL is required');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('This runner only migrates a local database');
}
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query('select pg_advisory_lock(728615823)');
  await client.query(
    'create table if not exists public.roster_local_migrations(name text primary key, sha256 text not null, applied_at timestamptz not null default now())',
  );
  await client.query('revoke all on public.roster_local_migrations from public');
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const files = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && entry.name.endsWith('.sql')) files.push(entry.name);
  }
  for (const name of files.sort()) {
    const sql = await Deno.readTextFile(new URL(name, directory));
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql))),
      (x) => x.toString(16).padStart(2, '0'),
    ).join('');
    const applied = await client.query(
      'select sha256 from public.roster_local_migrations where name=$1',
      [name],
    );
    if (applied.rows.length) {
      if (applied.rows[0].sha256 !== hash) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    const baseline = Deno.args.includes('--baseline-initial') &&
      name === '20261101000000_initial.sql';
    await client.query('begin');
    try {
      if (baseline) {
        const row = await client.query(
          "select to_regclass('roster.issues') as issues,to_regclass('roster.audit_events') as audit",
        );
        if (!row.rows[0].issues || !row.rows[0].audit) {
          throw new Error('Initial migration is not present');
        }
      } else await client.query(sql);
      await client.query('insert into public.roster_local_migrations(name,sha256) values($1,$2)', [
        name,
        hash,
      ]);
      await client.query('commit');
      console.log(`${baseline ? 'Baselined' : 'Applied'} ${name}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
} finally {
  await client.query('select pg_advisory_unlock(728615823)');
  client.release();
  await pool.end();
}
