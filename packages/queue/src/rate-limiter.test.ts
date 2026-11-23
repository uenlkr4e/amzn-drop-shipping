import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTokenBucketLimiter, RateLimitTimeoutError } from './rate-limiter';
import { redisOptionsFromUrl } from './redis';

const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL must be set');
const redis = new Redis(redisOptionsFromUrl(url));
const limiter = createTokenBucketLimiter(redis, { keyPrefix: 'test-ratelimit' });

describe('token bucket limiter', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('allows up to capacity, then denies with a retry delay', async () => {
    const rule = { capacity: 3, refillPerSecond: 1 };
    for (let i = 0; i < 3; i++) {
      expect((await limiter.tryAcquire('sp-api:A1:getOrders', rule)).allowed).toBe(true);
    }
    const denied = await limiter.tryAcquire('sp-api:A1:getOrders', rule);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('keeps separate buckets per key', async () => {
    const rule = { capacity: 1, refillPerSecond: 1 };
    expect((await limiter.tryAcquire('sp-api:A1:getOrders', rule)).allowed).toBe(true);
    expect((await limiter.tryAcquire('sp-api:A2:getOrders', rule)).allowed).toBe(true);
  });

  it('acquire() waits for a token to refill', async () => {
    const rule = { capacity: 1, refillPerSecond: 20 };
    await limiter.acquire('keepa:main:product', rule);
    const started = Date.now();
    await limiter.acquire('keepa:main:product', rule);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });

  it('acquire() gives up after maxWaitMs', async () => {
    const rule = { capacity: 1, refillPerSecond: 0.1 };
    await limiter.acquire('slow:key', rule);
    await expect(limiter.acquire('slow:key', rule, { maxWaitMs: 100 })).rejects.toBeInstanceOf(
      RateLimitTimeoutError,
    );
  });

  it('rejects requests larger than the bucket', async () => {
    await expect(limiter.tryAcquire('k', { capacity: 1, refillPerSecond: 1 }, 2)).rejects.toThrow(
      RangeError,
    );
  });
});
