import { Pool } from 'npm:pg@8.23.1';
import { createJobs } from '../jobs.ts';
import { prepareTestDatabase } from '../test_support.ts';
const url = Deno.env.get('ROSTER_INTEGRATIONS_TEST_DATABASE_URL');
Deno.test({
  name: 'Background job endpoint requires its own token and runs cycle/GitHub workers',
  ignore: !url,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const setup = new Pool({ connectionString: url });
    await prepareTestDatabase(setup);
    const u = new URL(url!);
    u.username = 'roster_test_runtime';
    const jobs = createJobs({
      DATABASE_URL: u.toString(),
      JOBS_TOKEN: 'test-job-secret',
      GITHUB_BINDINGS: '[]',
    });
    const assert = (v: unknown) => {
      if (!v) throw new Error('Unexpected job response');
    };
    try {
      assert(
        (await jobs.run(new Request('http://localhost/jobs/run', { method: 'POST' }))).status ===
          401,
      );
      assert(
        (await jobs.run(
          new Request('http://localhost/jobs/run', {
            method: 'POST',
            headers: { authorization: 'Bearer wrong' },
          }),
        )).status === 401,
      );
      assert(
        (await jobs.run(
          new Request('http://localhost/jobs/run', {
            method: 'GET',
            headers: { authorization: 'Bearer test-job-secret' },
          }),
        )).status === 405,
      );
      const result = await jobs.run(
        new Request('http://localhost/jobs/run', {
          method: 'POST',
          headers: { authorization: 'Bearer test-job-secret' },
        }),
      );
      assert(result.status === 200);
      assert((await result.json()).cycles === 'advanced');
    } finally {
      await jobs.close();
      await setup.end();
    }
  },
});
