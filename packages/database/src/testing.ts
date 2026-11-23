import { sql } from 'drizzle-orm';
import { createDatabase, type Database, type DatabaseHandle } from './client';
import { runMigrations } from './migrate';

/** Refuses any database whose name does not end in _test, so tests can never wipe real data. */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error('TEST_DATABASE_URL must be set for integration tests');
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to use database "${name}" for tests: name must end in _test`);
  }
  return url;
}

export function connectTestDatabase(): DatabaseHandle {
  return createDatabase(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL), {
    maxConnections: 5,
  });
}

export async function prepareTestDatabase(): Promise<void> {
  const handle = connectTestDatabase();
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE "user", verification, audit_logs, integration_logs, worker_heartbeats RESTART IDENTITY CASCADE`,
  );
}
