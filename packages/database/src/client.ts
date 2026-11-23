import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
  close(): Promise<void>;
}

export function createDatabase(
  url: string,
  options: { maxConnections?: number; onError?: (error: Error) => void } = {},
): DatabaseHandle {
  const pool = new Pool({ connectionString: url, max: options.maxConnections ?? 10 });
  // An idle client error with no listener would crash the process.
  pool.on('error', (error) => {
    if (options.onError) options.onError(error);
    else console.error('Postgres pool error', error);
  });
  const db = drizzle({ client: pool, schema });
  let closed = false;
  return {
    db,
    pool,
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
