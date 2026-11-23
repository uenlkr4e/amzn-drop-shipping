/** Plain structural options accepted by any ioredis copy (and BullMQ). */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  family: 0;
  maxRetriesPerRequest: null;
  tls?: Record<string, never>;
}

/**
 * Converts a redis:// or rediss:// URL to ioredis options suitable for BullMQ.
 * family: 0 lets ioredis resolve IPv6 addresses (Railway private networking).
 * maxRetriesPerRequest: null is required by BullMQ workers.
 */
export function redisOptionsFromUrl(url: string): RedisConnectionOptions {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis URL protocol: ${parsed.protocol}`);
  }
  const dbPath = parsed.pathname.replace(/^\//, '');
  if (dbPath && !/^\d+$/.test(dbPath)) {
    throw new Error(`Invalid Redis db "${dbPath}": must be a non-negative integer`);
  }
  const port = parsed.port ? Number(parsed.port) : 6379;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Redis port "${parsed.port}": must be 1-65535`);
  }
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: dbPath ? Number(dbPath) : 0,
    family: 0,
    maxRetriesPerRequest: null,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
