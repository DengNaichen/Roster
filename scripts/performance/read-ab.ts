// Alternating real HTTP handlers over the same restricted Postgres pool. No mock responses or artificial delay.
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../packages/backend/src/platform/database/client.ts';
const [baseline, output] = Deno.args;
const connection = Deno.env.get('DATABASE_URL');
if (!connection || !baseline || !output) throw new Error('Provide a baseline checkout and output');
const url = new URL(connection);
if (
  url.hostname !== '127.0.0.1' || !/^\/roster_wt_[a-f0-9]{12}_preview$/.test(url.pathname) ||
  url.username !== 'roster_preview_runtime'
) throw new Error('Only the restricted worktree preview database');
const { db, pool } = createDatabase(connection);
const ctx = {
  identity: {
    subject: 'b965fa67-d823-4534-a240-56b88f839dad',
    name: 'Local Developer',
    email: 'developer@roster.local',
  },
};
async function handler(root: URL) {
  const service: typeof import('../../packages/backend/src/service.ts') = await import(
    new URL('packages/backend/src/service.ts', root).href
  );
  const http: typeof import('../../packages/backend/src/transport/http/app.ts') = await import(
    new URL('packages/backend/src/transport/http/app.ts', root).href
  );
  const telemetry: typeof import('../../packages/backend/src/platform/telemetry/performance.ts') =
    await import(new URL('packages/backend/src/platform/telemetry/performance.ts', root).href);
  return {
    app: http.createHttpApp({
      service: service.createService(db),
      verify: async () => ctx,
      allowedOrigins: [],
    }),
    measure: telemetry.measureRequest,
  };
}
try {
  const versions = {
    before: await handler(pathToFileURL(baseline.replace(/\/$/, '') + '/')),
    after: await handler(new URL('../../', import.meta.url)),
  };
  const samples: {
    workspace: string;
    scenario: string;
    phase: 'before' | 'after';
    ms: number;
    sqlCount: number;
    bytes: number;
  }[] = [];
  for (const workspace of ['perf-baseline-v2', 'perf-joined-v1']) {
    for (const scenario of ['list', 'detail']) {
      const path = `http://fixture.local/api/w/${workspace}/issues${
        scenario === 'list' ? '?team=PERF&limit=50' : '/PERF-1'
      }`;
      let reference = '';
      for (let round = -3; round < 40; round++) {
        for (
          const phase
            of (round % 2 ? ['before', 'after'] : ['after', 'before']) as ('before' | 'after')[]
        ) {
          const version = versions[phase];
          const start = performance.now();
          const response = await version.measure(() => version.app.request(path));
          const body = await response.text();
          const ms = performance.now() - start;
          if (!response.ok) throw new Error(`Business response ${response.status}`);
          if (reference && body !== reference) throw new Error('Before/after HTTP payload differs');
          reference = body;
          if (!response.headers.has('x-roster-sql-count')) {
            throw new Error('Missing SQL diagnostic');
          }
          if (round >= 0) {
            samples.push({
              workspace,
              scenario,
              phase,
              ms,
              sqlCount: Number(response.headers.get('x-roster-sql-count')),
              bytes: new TextEncoder().encode(body).length,
            });
          }
        }
      }
    }
  }
  await Deno.writeTextFile(
    output,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        mode:
          'in-process real HTTP handlers, same restricted Postgres pool; excludes browser/TCP; alternates order, 3 warmups then40samples/version/scenario; exact payload equality required',
        baseline,
        samples,
      },
      null,
      2,
    ) + '\n',
  );
  const percentile = (a: number[], q: number) =>
    a.sort((a, b) => a - b)[Math.ceil(a.length * q) - 1];
  console.log(
    JSON.stringify([
      ...new Set(samples.map((s) => `${s.workspace}/${s.scenario}/${s.phase}`)),
    ].map((key) => {
      const rows = samples.filter((s) => `${s.workspace}/${s.scenario}/${s.phase}` === key);
      return {
        key,
        p50: percentile(rows.map((r) => r.ms), .5),
        p95: percentile(rows.map((r) => r.ms), .95),
        sql: rows[0].sqlCount,
      };
    })),
  );
} finally {
  await pool.end();
}
