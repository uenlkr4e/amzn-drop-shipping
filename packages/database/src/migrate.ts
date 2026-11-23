import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

/** Works from both src/ (tests) and dist/ (runtime): migrations/ is a sibling of both. */
export const MIGRATIONS_FOLDER = join(__dirname, '..', 'migrations');

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
