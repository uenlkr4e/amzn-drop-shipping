import type { Redis } from 'ioredis';

// Token bucket stored as a Redis hash. Uses Redis TIME so all callers share one clock.
// Returns { allowed (0|1), retryAfterMs }.
const TOKEN_BUCKET_LUA = `
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local requested = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
tokens = math.min(capacity, tokens + (math.max(0, now - ts) / 1000) * rate)
local allowed = 0
local retry_after = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  retry_after = math.ceil(((requested - tokens) / rate) * 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity / rate) * 1000) + 1000)
return { allowed, retry_after }
`;

const COMMAND = 'dropshipTokenBucket';

type RedisWithTokenBucket = Redis & {
  [COMMAND](
    key: string,
    capacity: number,
    refillPerSecond: number,
    tokens: number,
  ): Promise<[number, number]>;
};

export interface TokenBucketRule {
  /** Maximum burst size. */
  capacity: number;
  /** Sustained rate. Use the provider's documented rate, e.g. SP-API getOrders = 0.0167. */
  refillPerSecond: number;
}

export interface AcquireResult {
  allowed: boolean;
  retryAfterMs: number;
}

export class RateLimitTimeoutError extends Error {
  constructor(
    readonly key: string,
    readonly maxWaitMs: number,
  ) {
    super(`Rate limit wait for "${key}" would exceed ${maxWaitMs}ms`);
    this.name = 'RateLimitTimeoutError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shared limiter for provider calls. Key convention: `${provider}:${accountRef}:${operation}`,
 * e.g. `sp-api:A1B2C3:getItemOffers` or `keepa:main:product`.
 */
export function createTokenBucketLimiter(redis: Redis, options: { keyPrefix?: string } = {}) {
  const prefix = options.keyPrefix ?? 'ratelimit';
  if (!(COMMAND in redis)) {
    redis.defineCommand(COMMAND, { numberOfKeys: 1, lua: TOKEN_BUCKET_LUA });
  }
  const client = redis as RedisWithTokenBucket;

  async function tryAcquire(
    key: string,
    rule: TokenBucketRule,
    tokens = 1,
  ): Promise<AcquireResult> {
    if (!Number.isFinite(rule.capacity) || rule.capacity <= 0) {
      throw new RangeError(`Bucket capacity must be a finite number > 0, got ${rule.capacity}`);
    }
    if (!Number.isFinite(rule.refillPerSecond) || rule.refillPerSecond <= 0) {
      throw new RangeError(
        `refillPerSecond must be a finite number > 0, got ${rule.refillPerSecond}`,
      );
    }
    if (!Number.isFinite(tokens) || tokens <= 0) {
      throw new RangeError(`Requested tokens must be a finite number > 0, got ${tokens}`);
    }
    if (tokens > rule.capacity) {
      throw new RangeError(`Requested ${tokens} tokens but bucket capacity is ${rule.capacity}`);
    }
    const [allowed, retryAfterMs] = await client[COMMAND](
      `${prefix}:${key}`,
      rule.capacity,
      rule.refillPerSecond,
      tokens,
    );
    return { allowed: allowed === 1, retryAfterMs };
  }

  /**
   * Waits until a token is available. If the time to the next token would exceed `maxWaitMs`
   * (default 30s), throws `RateLimitTimeoutError` immediately instead of sleeping; callers such
   * as BullMQ jobs should catch it and delay/retry the job. Sleeps carry +/-10% jitter so many
   * waiters do not stampede.
   */
  async function acquire(
    key: string,
    rule: TokenBucketRule,
    opts: { tokens?: number; maxWaitMs?: number } = {},
  ): Promise<void> {
    const maxWaitMs = opts.maxWaitMs ?? 30_000;
    const started = Date.now();
    for (;;) {
      const result = await tryAcquire(key, rule, opts.tokens ?? 1);
      if (result.allowed) return;
      const delayMs = result.retryAfterMs * (0.9 + Math.random() * 0.2);
      if (Date.now() - started + delayMs > maxWaitMs) {
        throw new RateLimitTimeoutError(key, maxWaitMs);
      }
      await sleep(delayMs);
    }
  }

  return { tryAcquire, acquire };
}

export type TokenBucketLimiter = ReturnType<typeof createTokenBucketLimiter>;
