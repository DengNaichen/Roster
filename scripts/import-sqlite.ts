import { Pool } from 'npm:pg@8.23.1';
import { importSQLite } from '../packages/backend/src/integrations/imports/postgres.ts';
const [snapshotPath, mapPath] = Deno.args;
if (!snapshotPath || !mapPath || !Deno.env.get('DATABASE_URL')) {
  throw new Error(
    'Usage: DATABASE_URL=... deno run --allow-env --allow-net --allow-read scripts/import-sqlite.ts snapshot.json identities.json',
  );
}
const pool = new Pool({ connectionString: Deno.env.get('DATABASE_URL'), max: 1 });
try {
  const result = await importSQLite(
    pool,
    JSON.parse(await Deno.readTextFile(snapshotPath)),
    JSON.parse(await Deno.readTextFile(mapPath)),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
