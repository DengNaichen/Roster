// EXPLAIN the exact SELECT statements emitted by real HTTP handlers on local synthetic fixtures.
import { type SQL, sql } from 'npm:drizzle-orm@0.45.4';
import { PgDialect } from 'npm:drizzle-orm@0.45.4/pg-core';
import { createDatabase } from '../../packages/backend/src/platform/database/client.ts';
import { createService } from '../../packages/backend/src/service.ts';
import { createHttpApp } from '../../packages/backend/src/transport/http/app.ts';
const [slug, output] = Deno.args;
const connection = Deno.env.get('DATABASE_URL');
if (!connection) throw new Error('DATABASE_URL required');
const url = new URL(connection);
if (
  url.hostname !== '127.0.0.1' || !/^\/roster_wt_[a-f0-9]{12}_preview$/.test(url.pathname) ||
  url.username !== 'roster_preview_runtime' || !/^perf-[a-z0-9-]+$/.test(slug) || !output
) throw new Error('Only isolated restricted local perf-* fixtures');
const { db, pool } = createDatabase(connection);
let record = false;
const queries: SQL[] = [];
const traced = new Proxy(db, {
  get(target, key, receiver) {
    if (key === 'execute') {
      return (query: SQL) => {
        if (record) queries.push(query);
        return target.execute(query);
      };
    }
    return Reflect.get(target, key, receiver);
  },
});
const ctx = {
  identity: {
    subject: 'b965fa67-d823-4534-a240-56b88f839dad',
    name: 'Local Developer',
    email: 'developer@roster.local',
  },
};
const app = createHttpApp({
  service: createService(traced),
  verify: async () => ctx,
  allowedOrigins: [],
});
const dialect = new PgDialect();
const reports = [];
try {
  for (const path of [`/api/w/${slug}/issues?team=PERF&limit=50`, `/api/w/${slug}/issues/PERF-1`]) {
    queries.length = 0;
    record = true;
    const response = await app.request(`http://fixture.local${path}`);
    record = false;
    if (!response.ok) throw new Error(`Business handler returned ${response.status}`);
    const body = await response.json();
    // PERF-50 is the mutation target; the other 49 summaries and PERF-1 details remain immutable.
    const stable = Array.isArray(body.issues)
      ? {
        ...body,
        issues: body.issues.filter((issue: { identifier: string }) =>
          issue.identifier !== 'PERF-50'
        ),
      }
      : body;
    const stableJson = JSON.stringify(stable);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    const plans = [];
    for (const query of queries) {
      const text = dialect.sqlToQuery(query).sql;
      if (!/^\s*(select|with)\b/i.test(text)) throw new Error('Only read plans are allowed');
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`set transaction read only`);
        return await tx.execute(sql`explain(analyze,buffers,format json) ${query}`);
      });
      plans.push({ sql: text, plan: result.rows[0] });
    }
    reports.push({
      path: path.endsWith('/PERF-1') ? 'detail' : 'list',
      sqlCount: queries.length,
      responseStableSha256: digest,
      plans,
    });
  }
  await Deno.writeTextFile(
    output,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        workspace: slug,
        database: url.pathname.slice(1),
        role: url.username,
        mode:
          'real HTTP handlers, restricted local PostgreSQL; EXPLAIN executed on captured read statements',
        reports,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify(
      reports.map(({ path, sqlCount, responseStableSha256 }) => ({
        path,
        sqlCount,
        responseStableSha256,
      })),
    ),
  );
} finally {
  await pool.end();
}
