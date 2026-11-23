import 'reflect-metadata';
import type { WorkerEnv } from '@dropship/config';
import { type Database, listHeartbeats } from '@dropship/database';
import { truncateAll } from '@dropship/database/testing';
import { DATABASE } from '@dropship/nest-common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HeartbeatService } from '../src/heartbeat/heartbeat.service';
import { WorkersModule } from '../src/workers.module';
import { testWorkerEnv } from './test-env';

describe('heartbeat when Redis is unreachable', () => {
  let app: TestingModule;
  let db: Database;

  beforeEach(async () => {
    const env: WorkerEnv = { ...testWorkerEnv(), REDIS_URL: 'redis://127.0.0.1:1/1' };
    // compile() only builds providers; app.init() would block on the unreachable Redis.
    app = await Test.createTestingModule({ imports: [WorkersModule.forRoot(env)] }).compile();
    db = app.get(DATABASE);
    await truncateAll(db);
  });
  afterEach(async () => {
    await app.close();
  });

  it('skips the heartbeat so the dashboard marks the worker stale', async () => {
    await app.get(HeartbeatService).beat();
    expect(await listHeartbeats(db)).toEqual([]);
  });
});
