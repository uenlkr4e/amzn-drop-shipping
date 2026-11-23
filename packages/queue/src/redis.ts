import type { RedisOptions } from 'ioredis';

/**
 * Converts a redis:// or rediss:// URL to ioredis options suitable for BullMQ.
 * family: 0 lets ioredis resolve IPv6 addresses (Railway private networking).
 * maxRetriesPerRequest: null is required by BullMQ workers.
 */
export function redisOptionsFromUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis URL protocol: ${parsed.protocol}`);
  }
  const dbPath = parsed.pathname.replace(/^\//, '');
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: dbPath ? Number(dbPath) : 0,
    family: 0,
    maxRetriesPerRequest: null,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
