import { AsyncLocalStorage } from 'node:async_hooks';

type Measurement = { count: number; milliseconds: number };
const measurements = new AsyncLocalStorage<Measurement>();

/** Counts application SQL executions, including failures. No SQL or values are retained. */
export async function measureQuery<T>(run: () => Promise<T>): Promise<T> {
  const measurement = measurements.getStore();
  if (!measurement) return run();
  const start = performance.now();
  measurement.count++;
  try {
    return await run();
  } finally {
    measurement.milliseconds += performance.now() - start;
  }
}

/** Opt-in diagnostic wrapper; transaction control statements are not included in sql-count. */
export async function measureRequest(run: () => Response | Promise<Response>): Promise<Response> {
  const measurement: Measurement = { count: 0, milliseconds: 0 };
  const start = performance.now();
  const response = await measurements.run(measurement, run);
  // SSE response headers are sent before streamed tools finish. Never publish partial counters.
  if (!response.ok || response.headers.get('Content-Type')?.includes('text/event-stream')) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set(
    'Server-Timing',
    `app;dur=${(performance.now() - start).toFixed(2)}, sql;dur=${
      measurement.milliseconds.toFixed(2)
    }`,
  );
  headers.set('X-Roster-Sql-Count', String(measurement.count));
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  headers.append(
    'Access-Control-Expose-Headers',
    'Server-Timing, X-Roster-Sql-Count, x-sb-edge-region',
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
