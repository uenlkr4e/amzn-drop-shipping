import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verification, workerHeartbeats } from './schema';
import { connectTestDatabase, truncateAll } from './testing';

describe('truncateAll', () => {
  const handle = connectTestDatabase();
  beforeAll(() => truncateAll(handle.db));
  afterAll(() => handle.close());

  it('empties verification and worker_heartbeats', async () => {
    const { db } = handle;
    await db.insert(verification).values({
      id: 'v1',
      identifier: 'a@example.com',
      value: 'code',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db
      .insert(workerHeartbeats)
      .values({ workerGroup: 'g', instanceId: 'i', startedAt: new Date() });

    await truncateAll(db);

    const v = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM verification`);
    const w = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM worker_heartbeats`,
    );
    expect(v.rows[0]?.n).toBe(0);
    expect(w.rows[0]?.n).toBe(0);
  });
});
