import type { SQL } from 'npm:drizzle-orm@0.45.4';
import { fail } from '../errors/validation.ts';
import type { Database } from './client.ts';
export type Row = Record<string, unknown>;
export type Executor = Pick<Database, 'execute'>;
export async function rows(db: Executor, query: SQL): Promise<Row[]> {
  return (await db.execute(query)).rows as Row[];
}
export async function one(db: Executor, query: SQL): Promise<Row> {
  const row = (await rows(db, query))[0];
  return row ?? fail('not_found', 'Resource not found');
}
