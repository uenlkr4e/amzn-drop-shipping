import 'reflect-metadata';
import { REDIS } from '@dropship/nest-common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory';
import { testApiEnv } from './test-env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('health endpoints', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(testApiEnv());
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/live returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/health/ready checks database and redis', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('echoes the x-request-id header for correlation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health/live',
      headers: { 'x-request-id': 'corr-123' },
    });
    expect(res.headers['x-request-id']).toBe('corr-123');
  });

  it('generates a UUID request id when none is sent', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('does not echo an oversized or malformed x-request-id', async () => {
    for (const bad of ['a'.repeat(8000), 'bad id<script>']) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health/live',
        headers: { 'x-request-id': bad },
      });
      expect(res.headers['x-request-id']).toMatch(UUID);
    }
  });

  it('reports not ready when Redis is unreachable', async () => {
    const broken = await createApp(testApiEnv({ REDIS_URL: 'redis://127.0.0.1:1/0' }));
    try {
      const res = await broken.inject({ method: 'GET', url: '/api/health/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ checks: { database: 'ok', redis: 'error' } });

      // Later probes must fail fast and not pile PINGs into ioredis's offline queue.
      const redis = broken.get<Redis>(REDIS);
      for (let i = 0; i < 3; i++) {
        const started = Date.now();
        const again = await broken.inject({ method: 'GET', url: '/api/health/ready' });
        expect(again.statusCode).toBe(503);
        expect(Date.now() - started).toBeLessThan(500);
        const queue = (redis as unknown as { offlineQueue: { length: number } }).offlineQueue;
        expect(queue.length).toBeLessThanOrEqual(1);
      }
    } finally {
      await broken.close();
    }
  });
});
