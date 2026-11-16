import { readFile } from 'node:fs/promises';
const paths = process.argv.slice(2);
if (paths.length !== 2) throw new Error('Usage: write-report.mjs BEFORE.json AFTER.json');
const reports = await Promise.all(
  paths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
);
const controls = (report) =>
  JSON.stringify([
    report.schema,
    report.workspace,
    report.identifier,
    report.field,
    report.latencyMs,
    report.count,
    report.environment.browser,
    report.environment.origin,
  ]);
if (controls(reports[0]) !== controls(reports[1])) throw new Error('Measurement controls differ');
const percentile = (values, q) => {
  if (values.some((value) => value === null)) return 'unavailable';
  return values.sort((a, b) => a - b)[Math.ceil(values.length * q) - 1].toFixed(1);
};
console.log('| Warm samples (first excluded) | Before | After |');
console.log('| --- | ---: | ---: |');
for (const metric of ['matchedMs', 'confirmedMs', 'requests', 'sqlCount', 'bytes']) {
  for (const q of [.5, .95]) {
    const values = reports.map((report) =>
      percentile(
        report.samples.slice(1).map((sample) =>
          metric === 'requests'
            ? sample.requests.length
            : ['sqlCount', 'bytes'].includes(metric)
            ? sample.requests.some((request) => request[metric] === null)
              ? null
              : sample.requests.reduce((n, r) => n + r[metric], 0)
            : sample[metric]
        ),
        q,
      )
    );
    console.log(`| ${metric} P${q * 100} | ${values.join(' | ')} |`);
  }
}
console.log(
  'matchedMs is optimistic DOM feedback; confirmedMs is completed PATCH response. Node readback confirms persistence outside the request window. Local StrictMode preview with 300ms browser network emulation, not hosted latency.',
);
