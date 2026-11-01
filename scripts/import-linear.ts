import { Pool } from 'npm:pg@8.23.1';
import { importLinear } from '../packages/backend/src/integrations/import-linear.ts';
const [slug, team, directory] = Deno.args;
if (!slug || !team || !directory || !Deno.env.get('DATABASE_URL')) {
  throw new Error(
    'Usage: DATABASE_URL=... deno run --allow-env --allow-net --allow-read scripts/import-linear.ts WORKSPACE TEAM EXPORT_DIRECTORY',
  );
}
const pool = new Pool({ connectionString: Deno.env.get('DATABASE_URL'), max: 1 });
try {
  console.log(
    await importLinear(
      pool,
      slug,
      team,
      JSON.parse(await Deno.readTextFile(`${directory}/issues.json`)),
      JSON.parse(await Deno.readTextFile(`${directory}/projects.json`)),
    ),
  );
} finally {
  await pool.end();
}
