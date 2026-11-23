import { loadDotEnv } from '@dropship/config';
import { createDatabase } from './client';
import { runMigrations } from './migrate';

async function main() {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const handle = createDatabase(url, { maxConnections: 1 });
  try {
    await runMigrations(handle.db);
    console.log('Migrations applied');
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
