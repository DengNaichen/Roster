import { readFile } from 'node:fs/promises';
const allowRegion = process.argv.includes('--allow-region-change');
const paths = process.argv.slice(2).filter((arg) => arg !== '--allow-region-change');
if (!paths.length || paths.length > 2) {
  throw new Error('Usage: node scripts/performance/report.mjs before.json [after.json]');
}
const reports = await Promise.all(
  paths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
);
if (reports.length === 2) {
  const [before, after] = reports;
  const fixture = (report) =>
    JSON.stringify([
      report.dataset.issues,
      report.dataset.fixture,
      report.dataset.documentSha256 ?? report.dataset.sentinelDocumentSha256,
    ]);
  if (
    before.schema !== after.schema || before.count !== after.count ||
    before.browser !== after.browser || before.mode !== after.mode ||
    (!allowRegion && before.requestedRegion !== after.requestedRegion) ||
    fixture(before) !== fixture(after)
  ) throw new Error('Measurement controls or verified dataset differ; do not compare');
}
console.log(
  reports.map((report, i) =>
    `${i ? 'After' : 'Before'}: ${
      report.revision ?? 'unattested'
    }; region=${report.requestedRegion}; mode=${report.mode}; origin=${
      report.environment?.apiOrigin ?? 'unrecorded'
    }`
  ).join('\n'),
);
console.log(
  '| Scenario | Measurement | ' +
    reports.map((_, index) => index ? 'After' : 'Before').join(' | ') + ' |',
);
console.log('| --- | --- | ' + reports.map(() => '---:').join(' | ') + ' |');
for (const scenario of ['list-warm', 'detail-warm', 'write-warm']) {
  for (
    const [metric, percentile] of [
      ['ms', 'p50'],
      ['ms', 'p95'],
      ['bytes', 'p50'],
      ['sqlCount', 'p50'],
      ['sqlMs', 'p95'],
      ['parseMs', 'p95'],
    ]
  ) {
    console.log(
      `| ${scenario} | ${metric} ${percentile} | ` + reports.map((report) => {
        const value = report.summary[scenario]?.[metric]?.[percentile];
        return value == null ? 'unavailable' : Number(value.toFixed(2));
      }).join(' | ') + ' |',
    );
  }
}
