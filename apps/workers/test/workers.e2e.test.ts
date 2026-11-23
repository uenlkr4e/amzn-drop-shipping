import 'reflect-metadata';
import { type Database, listHeartbeats, recordHeartbeat } from '@dropship/database';
import { truncateAll } from '@dropship/database/testing';
import { DATABASE } from '@dropship/nest-common';
import { QUEUE_NAMES, redisOptionsFromUrl, SYSTEM_JOBS } from '@dropship/queue';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemProcessor } from '../src/system/system.processor';
import { WorkersModule } from '../src/workers.module';
import { testWorkerEnv } from './test-env';

describe('workers app', () => {
  let app: TestingModule;
  let db: Database;

  beforeEach(async () => {
    const env = testWorkerEnv();
    const redis = new Redis(redisOptionsFromUrl(env.REDIS_URL));
    await redis.flushdb();
    await redis.quit();
    app = await Test.createTestingModule({ imports: [WorkersModule.forRoot(env)] }).compile();
    db = app.get(DATABASE);
    await truncateAll(db);
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('records a heartbeat for each worker group on startup', async () => {
    const rows = await listHeartbeats(db);
    expect(rows.map((r) => r.workerGroup)).toEqual(['system']);
  });

  it('registers the prune-heartbeats job scheduler', async () => {
    const queue = app.get<Queue>(getQueueToken(QUEUE_NAMES.system));
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => s.key)).toContain(SYSTEM_JOBS.pruneHeartbeats);
  });

  it('prune-heartbeats deletes heartbeats older than the retention period', async () => {
    await recordHeartbeat(db, {
      workerGroup: 'system',
      instanceId: 'ancient',
      startedAt: new Date('2020-01-01T00:00:00Z'),
      seenAt: new Date('2020-01-01T00:00:00Z'),
    });
    const processor = app.get(SystemProcessor);
    const result = await processor.process({
      id: '1',
      name: SYSTEM_JOBS.pruneHeartbeats,
      data: {},
    } as Job);
    expect(result).toEqual({ deleted: 1 });
    const instanceIds = (await listHeartbeats(db)).map((r) => r.instanceId);
    expect(instanceIds).not.toContain('ancient');
  });

  it('rejects unknown system jobs', async () => {
    const processor = app.get(SystemProcessor);
    await expect(processor.process({ id: '2', name: 'nope', data: {} } as Job)).rejects.toThrow(
      /Unknown system job/,
    );
  });
});
