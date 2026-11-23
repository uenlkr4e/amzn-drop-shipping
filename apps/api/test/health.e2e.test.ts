import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory';
import { testApiEnv } from './test-env';

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

  it('reports not ready when Redis is unreachable', async () => {
    const broken = await createApp(testApiEnv({ REDIS_URL: 'redis://127.0.0.1:1/0' }));
    try {
      const res = await broken.inject({ method: 'GET', url: '/api/health/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ checks: { database: 'ok', redis: 'error' } });
    } finally {
      await broken.close();
    }
  });
});
