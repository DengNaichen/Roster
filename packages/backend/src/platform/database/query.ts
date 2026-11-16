import { measureQuery } from '../telemetry/performance.ts';
import type { SQL } from 'npm:drizzle-orm@0.45.4';
import { fail } from '../errors/validation.ts';
import type { Row } from '../../application/records.ts';
export type { Row } from '../../application/records.ts';
export type Executor = { execute(query: SQL): PromiseLike<{ rows: unknown[] }> };
const measured = new WeakMap<Executor, Executor>();
export function measuredExecutor(executor: Executor): Executor {
  const existing = measured.get(executor);
  if (existing) return existing;
  const wrapped: Executor = {
    execute: (query) => measureQuery(async () => await executor.execute(query)),
  };
  measured.set(executor, wrapped);
  measured.set(wrapped, wrapped);
  return wrapped;
}
export async function rows(db: Executor, query: SQL): Promise<Row[]> {
  return (await db.execute(query)).rows as Row[];
}
export async function one(db: Executor, query: SQL): Promise<Row> {
  const row = (await rows(db, query))[0];
  return row ?? fail('not_found', 'Resource not found');
}
