import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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
});
