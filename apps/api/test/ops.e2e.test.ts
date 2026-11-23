import 'reflect-metadata';
import type { ApiEnv } from '@dropship/config';
import { type Database, recordHeartbeat } from '@dropship/database';
import { truncateAll } from '@dropship/database/testing';
import { DATABASE } from '@dropship/nest-common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory';
import { signInAs } from './auth-helpers';
import { testApiEnv } from './test-env';

describe('GET /api/ops/status', () => {
  let app: NestFastifyApplication;
  let env: ApiEnv;
  let db: Database;

  beforeAll(async () => {
    env = testApiEnv();
    app = await createApp(env);
    db = app.get(DATABASE);
  });
  beforeEach(() => truncateAll(db));
  afterAll(async () => {
    await app.close();
  });

  it('returns queue counts and worker heartbeats with staleness for operators', async () => {
    await recordHeartbeat(db, {
      workerGroup: 'system',
      instanceId: 'fresh',
      startedAt: new Date(),
    });
    await recordHeartbeat(db, {
      workerGroup: 'system',
      instanceId: 'old',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      seenAt: new Date('2026-01-01T00:00:00Z'),
    });
    const cookie = await signInAs(app, env, 'operator');

    const res = await app.inject({ method: 'GET', url: '/api/ops/status', headers: { cookie } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.queues).toContainEqual(
      expect.objectContaining({
        name: 'system',
        waiting: expect.any(Number),
        failed: expect.any(Number),
      }),
    );
    const staleByInstance = Object.fromEntries(
      body.workers.map((w: { instanceId: string; stale: boolean }) => [w.instanceId, w.stale]),
    );
    expect(staleByInstance).toEqual({ fresh: false, old: true });
  });

  it('is forbidden for viewers', async () => {
    const cookie = await signInAs(app, env, 'viewer');
    const res = await app.inject({ method: 'GET', url: '/api/ops/status', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});
