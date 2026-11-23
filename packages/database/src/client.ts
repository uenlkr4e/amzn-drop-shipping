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
  options: { maxConnections?: number } = {},
): DatabaseHandle {
  const pool = new Pool({ connectionString: url, max: options.maxConnections ?? 10 });
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
