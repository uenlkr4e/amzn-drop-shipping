import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../client';
import { integrationLogs } from '../schema';
import { connectTestDatabase, truncateAll } from '../testing';
import { withIntegrationLog } from './integration-logs';

describe('withIntegrationLog', () => {
  const handle = connectTestDatabase();
  beforeEach(() => truncateAll(handle.db));
  afterAll(() => handle.close());

  it('records a success with duration and returns the result', async () => {
    const result = await withIntegrationLog(
      handle.db,
      { provider: 'keepa', operation: 'product', accountRef: 'main' },
      async () => 42,
    );
    expect(result).toBe(42);
    const rows = await handle.db.select().from(integrationLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'keepa', operation: 'product', status: 'success' });
    expect(rows[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records an error and rethrows it', async () => {
    const failing = withIntegrationLog(
      handle.db,
      { provider: 'sp-api', operation: 'getOrders' },
      async () => {
        throw Object.assign(new Error('boom'), { status: 503 });
      },
    );
    await expect(failing).rejects.toThrow('boom');
    const rows = await handle.db.select().from(integrationLogs);
    expect(rows[0]).toMatchObject({ status: 'error', errorMessage: 'boom', httpStatus: 503 });
  });

  it('records 429 responses as throttled', async () => {
    const throttled = withIntegrationLog(
      handle.db,
      { provider: 'sp-api', operation: 'getOrders' },
      async () => {
        throw Object.assign(new Error('Too Many Requests'), { status: 429 });
      },
    );
    await expect(throttled).rejects.toThrow();
    const rows = await handle.db.select().from(integrationLogs);
    expect(rows[0]?.status).toBe('throttled');
  });

  it('records a nested response.status of 429 as throttled', async () => {
    const throttled = withIntegrationLog(
      handle.db,
      { provider: 'sp-api', operation: 'getOrders' },
      async () => {
        throw Object.assign(new Error('Too Many Requests'), { response: { status: 429 } });
      },
    );
    await expect(throttled).rejects.toThrow();
    const rows = await handle.db.select().from(integrationLogs);
    expect(rows[0]).toMatchObject({ status: 'throttled', httpStatus: 429 });
  });

  it('accepts numeric string statuses', async () => {
    const throttled = withIntegrationLog(handle.db, { provider: 'x', operation: 'y' }, async () => {
      throw Object.assign(new Error('slow down'), { status: '429' });
    });
    await expect(throttled).rejects.toThrow();
    const rows = await handle.db.select().from(integrationLogs);
    expect(rows[0]).toMatchObject({ status: 'throttled', httpStatus: 429 });
  });

  it('truncates very long error messages to 2000 characters', async () => {
    const failing = withIntegrationLog(handle.db, { provider: 'x', operation: 'y' }, async () => {
      throw new Error('a'.repeat(5000));
    });
    await expect(failing).rejects.toThrow();
    const rows = await handle.db.select().from(integrationLogs);
    expect(rows[0]?.errorMessage).toHaveLength(2000);
  });

  describe('when the log insert fails', () => {
    const brokenDb = {
      insert: () => {
        throw new Error('db down');
      },
    } as unknown as Database;

    it('still returns the result of a successful call exactly once', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const call = vi.fn(async () => 'ok');
      await expect(
        withIntegrationLog(brokenDb, { provider: 'x', operation: 'y' }, call),
      ).resolves.toBe('ok');
      expect(call).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('rethrows the original provider error, not the logging error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failing = withIntegrationLog(brokenDb, { provider: 'x', operation: 'y' }, async () => {
        throw new Error('provider exploded');
      });
      await expect(failing).rejects.toThrow('provider exploded');
      spy.mockRestore();
    });
  });
});
