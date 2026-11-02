import type { Pool } from 'npm:pg@8.23.1';
import { importLinear as runLinear } from './application/linear.ts';
import {
  type IdentityMap,
  importSQLite as runSQLite,
  type SQLiteSnapshot,
} from './application/sqlite.ts';
import { createLinearStore } from './infrastructure/linear.ts';
import { createSnapshotStore } from './infrastructure/sqlite.ts';
export type { IdentityMap, SQLiteSnapshot } from './application/sqlite.ts';
export function importSQLite(pool: Pool, snapshot: SQLiteSnapshot, mapping: IdentityMap) {
  return runSQLite(createSnapshotStore(pool), snapshot, mapping);
}
export function importLinear(
  pool: Pool,
  ...args: Parameters<typeof runLinear> extends [unknown, ...infer Rest] ? Rest : never
) {
  return runLinear(createLinearStore(pool), ...args);
}
