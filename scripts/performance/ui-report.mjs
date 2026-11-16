import { readFile } from 'node:fs/promises';
const paths = process.argv.slice(2);
if (!paths.length || paths.length > 2) {
  throw new Error('Usage: node scripts/performance/ui-report.mjs before.json [after.json]');
}
const reports = await Promise.all(
  paths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
);
if (reports.length === 2) {
  const controls = (report) =>
    JSON.stringify([
      report.schema,
      report.workspace,
      report.identifier,
      report.environment.browser,
      report.environment.origin,
      report.samples.length,
    ]);
  if (controls(reports[0]) !== controls(reports[1])) {
    throw new Error('UI measurement controls differ');
  }
}
const percentile = (values, q) => values.sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
console.log(
  '| Scenario (first pair excluded) | Metric | ' +
    reports.map((_, i) => i ? 'After' : 'Before').join(' | ') + ' |',
);
console.log('| --- | --- | ' + reports.map(() => '---:').join(' | ') + ' |');
for (const scenario of ['list-to-detail', 'detail-to-list']) {
  for (
    const [metric, q] of [['matchedMs', 0.5], ['matchedMs', 0.95], ['requests', 0.5], [
      'requests',
      0.95,
    ]]
  ) {
    const values = reports.map((report) => {
      const samples = report.samples.filter((sample) => sample.scenario === scenario).slice(1);
      return percentile(
        samples.map((sample) => metric === 'requests' ? sample.requests.length : sample[metric]),
        q,
      ).toFixed(1);
    });
    console.log(`| ${scenario} | ${metric} P${q * 100} | ${values.join(' | ')} |`);
  }
}
console.log(
  'Counts include requests from arm through visibility (including hover); timings are DOM match, not paint or complete interactive readiness. These are Vite StrictMode development samples.',
);
