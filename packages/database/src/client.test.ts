import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl, connectTestDatabase } from './testing';

describe('database client', () => {
  const handle = connectTestDatabase();
  afterAll(() => handle.close());

  it('connects and sees the migrated tables', async () => {
    const result = await handle.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = result.rows.map((r) => r.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'user',
        'session',
        'audit_logs',
        'integration_logs',
        'worker_heartbeats',
      ]),
    );
  });

  it('refuses non-test database names', () => {
    expect(() => assertTestDatabaseUrl('postgres://u:p@localhost:5432/dropship')).toThrow(/_test/);
  });

  it('close() is idempotent', async () => {
    const extra = connectTestDatabase();
    await extra.close();
    await expect(extra.close()).resolves.toBeUndefined();
  });
});
