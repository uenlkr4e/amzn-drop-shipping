import { describe, expect, it } from 'vitest';
import { redisOptionsFromUrl } from './redis';

describe('redisOptionsFromUrl', () => {
  it('parses host, port, credentials and db', () => {
    const options = redisOptionsFromUrl('redis://default:p%40ss@redis.railway.internal:6380/2');
    expect(options).toMatchObject({
      host: 'redis.railway.internal',
      port: 6380,
      username: 'default',
      password: 'p@ss',
      db: 2,
      family: 0,
      maxRetriesPerRequest: null,
    });
    expect(options.tls).toBeUndefined();
  });

  it('defaults port and db and enables TLS for rediss://', () => {
    const options = redisOptionsFromUrl('rediss://example.com');
    expect(options).toMatchObject({ port: 6379, db: 0 });
    expect(options.tls).toEqual({});
  });

  it('rejects non-redis protocols', () => {
    expect(() => redisOptionsFromUrl('http://example.com')).toThrow(/protocol/);
  });

  it('rejects a non-integer or negative db', () => {
    expect(() => redisOptionsFromUrl('redis://host/abc')).toThrow(/db/);
    expect(() => redisOptionsFromUrl('redis://host/-1')).toThrow(/db/);
    expect(() => redisOptionsFromUrl('redis://host/1.5')).toThrow(/db/);
  });

  it('rejects out-of-range ports', () => {
    expect(() => redisOptionsFromUrl('redis://host:0')).toThrow();
    expect(() => redisOptionsFromUrl('redis://host:99999')).toThrow();
  });

  it('strips IPv6 brackets from the host', () => {
    expect(redisOptionsFromUrl('redis://[::1]:6379/0').host).toBe('::1');
  });
});
