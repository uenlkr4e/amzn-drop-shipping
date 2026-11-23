import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDatabase, truncateAll } from '../testing';
import { listHeartbeats, pruneHeartbeats, recordHeartbeat } from './heartbeats';

describe('heartbeat repository', () => {
  const handle = connectTestDatabase();
  beforeEach(() => truncateAll(handle.db));
  afterAll(() => handle.close());

  it('upserts one row per worker group and instance', async () => {
    const startedAt = new Date('2026-01-01T00:00:00Z');
    await recordHeartbeat(handle.db, { workerGroup: 'system', instanceId: 'a', startedAt });
    await recordHeartbeat(handle.db, { workerGroup: 'system', instanceId: 'a', startedAt });
    await recordHeartbeat(handle.db, { workerGroup: 'system', instanceId: 'b', startedAt });
    const rows = await listHeartbeats(handle.db);
    expect(rows.map((r) => r.instanceId).sort()).toEqual(['a', 'b']);
  });

  it('prunes rows last seen before the cutoff', async () => {
    const startedAt = new Date();
    await recordHeartbeat(handle.db, {
      workerGroup: 'system',
      instanceId: 'old',
      startedAt,
      seenAt: new Date('2020-01-01T00:00:00Z'),
    });
    await recordHeartbeat(handle.db, { workerGroup: 'system', instanceId: 'new', startedAt });
    const deleted = await pruneHeartbeats(handle.db, new Date('2021-01-01T00:00:00Z'));
    expect(deleted).toBe(1);
    const rows = await listHeartbeats(handle.db);
    expect(rows.map((r) => r.instanceId)).toEqual(['new']);
  });
});
