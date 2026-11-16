// Refuse to summarize mixed/unidentified runtimes as one final acceptance run.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const dir = resolve(process.argv[2] ?? 'docs/performance');
const names = ['final-after', 'lifecycle', 'access', 'conditional', 'content'];
const [visible, life, access, conditional, content] = await Promise.all(
  names.map((name) => readFile(resolve(dir, `rst-7-${name}.json`), 'utf8').then(JSON.parse)),
);
const hashes = new Set(
  [visible, life, access, conditional, content].map((x) => x.source?.runtimeSha256),
);
if (
  hashes.size !== 1 || ![...hashes].every((h) => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h))
) throw Error('Final artifacts must identify the same measured runtime');
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const stats = (values) => ({
  n: values.length,
  p50: +percentile(values, .5).toFixed(2),
  p95: +percentile(values, .95).toFixed(2),
});
const assert = (value, message) => {
  if (!value) throw Error(message);
};
assert(
  visible.samples.length >= 5 &&
    visible.samples.every((s) =>
      !s.timeout && s.status === 200 && s.visibility === 'visible' && s.online &&
      s.visibilityMs >= 0 && s.visibilityMs <= 30000
    ),
  'Visible MCP target failed',
);
const observations = Object.fromEntries(life.observations.map((o) => [o.name, o]));
const idle = observations['unchanged-visible-32s'];
const hidden = observations['hidden-32s'];
const offline = observations['offline-17s'];
assert(
  idle.requests.length > 0 &&
    idle.requests.every((r) => r.status === 304 && r.bytes === 0 && r.sqlCount !== null),
  'Idle conditional requests not verified',
);
assert(
  hidden.visibleAt - hidden.hiddenAt >= 31000 && hidden.requests.length === 0,
  'Hidden-page pause failed',
);
assert(offline.online === false && offline.requests.length === 0, 'Offline pause failed');
for (const name of ['focus-catch-up', 'reconnect-catch-up', 'network-failure-recovered']) {
  assert(observations[name].observedDelayMs < 5000, 'Lifecycle recovery failed');
}
const failed = observations['blocked-url-backoff'].requests;
const queryId = failed[0].queryId;
const attempts = failed.filter((r) => r.queryId === queryId).map((r) => r.startMs);
assert(
  attempts.length >= 4 && attempts[2] - attempts[1] >= 29500,
  '30-second failure backoff not observed',
);
assert(
  access.observations.length === 5 &&
    access.observations.every((o) => o.titlePresent === o.name.endsWith('restored')),
  'Permission/deletion outcome failed',
);
const api = {};
for (const resource of ['list', 'detail']) {
  for (const cached of [false, true]) {
    const rows = conditional.rows.filter((r) =>
      r.resource === resource && r.conditional === cached
    );
    assert(
      rows.length === 20 && rows.every((r) => r.status === (cached ? 304 : 200)),
      'Conditional comparison incomplete',
    );
    api[`${resource}-${cached ? 'conditional' : 'full'}`] = {
      ms: stats(rows.map((r) => r.ms)),
      bytes: [...new Set(rows.map((r) => r.bytes))],
      sql: [...new Set(rows.map((r) => r.sqlCount))],
    };
  }
}
assert(
  content.draftPreserved === true && content.observations.length === 3 &&
    content.observations.every((o) => o.status === 200 && o.observedDelayMs <= 30000),
  'Remote content or draft preservation failed',
);
let maxInFlight = 0;
for (const queryId of new Set(idle.requests.map((r) => r.queryId))) {
  const events = idle.requests.filter((r) => r.queryId === queryId).flatMap(
    (r) => [[r.startMs, 1], [r.endMs, -1]],
  ).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let count = 0;
  for (const [, change] of events) {
    count += change;
    maxInFlight = Math.max(maxInFlight, count);
  }
}
assert(maxInFlight === 1, 'Overlapping periodic requests for the same query');
console.log(JSON.stringify(
  {
    runtimeSha256: [...hashes][0],
    mcpVisibilityMs: stats(visible.samples.map((s) => s.visibilityMs)),
    idle: {
      windowMs: 32000,
      requests: idle.requests.length,
      sql: idle.requests.reduce((n, r) => n + r.sqlCount, 0),
      bodyBytes: 0,
      maxInFlightPerQuery: maxInFlight,
    },
    hiddenMs: hidden.visibleAt - hidden.hiddenAt,
    focusMs: observations['focus-catch-up'].observedDelayMs,
    reconnectMs: observations['reconnect-catch-up'].observedDelayMs,
    backoffGapMs: attempts[2] - attempts[1],
    focusTriggeredFailureRecoveryMs: observations['network-failure-recovered'].observedDelayMs,
    access: access.observations.map((o) => ({ scenario: o.name, ms: o.observedDelayMs })),
    content: content.observations.map((o) => ({ scenario: o.name, ms: o.observedDelayMs })),
    api,
  },
  null,
  2,
));
