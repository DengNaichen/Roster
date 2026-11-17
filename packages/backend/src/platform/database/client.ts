import { drizzle, type NodePgDatabase } from 'npm:drizzle-orm@0.45.4/node-postgres';
import { Pool } from 'npm:pg@8.23.1';
export type Database = NodePgDatabase;
export function createDatabase(
  connectionString: string,
  timeouts?: { connectionTimeoutMillis: number; query_timeout: number },
) {
  const pool = new Pool({ connectionString, max: 5, ...timeouts });
  return { db: drizzle(pool), pool };
}
