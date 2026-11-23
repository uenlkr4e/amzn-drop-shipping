import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDatabase, truncateAll } from '../testing';
import { listAuditEntries, recordAudit } from './audit';

describe('audit repository', () => {
  const handle = connectTestDatabase();
  beforeEach(() => truncateAll(handle.db));
  afterAll(() => handle.close());

  it('records entries and lists them newest first for an entity', async () => {
    await recordAudit(handle.db, {
      actorType: 'system',
      action: 'pricing_rule.created',
      entityType: 'pricing_rule',
      entityId: 'r1',
      after: { markup: '0.02' },
    });
    await recordAudit(handle.db, {
      actorType: 'system',
      action: 'pricing_rule.updated',
      entityType: 'pricing_rule',
      entityId: 'r1',
      before: { markup: '0.02' },
      after: { markup: '0.03' },
      correlationId: 'req-1',
    });
    await recordAudit(handle.db, { actorType: 'system', action: 'x', entityType: 'other' });

    const entries = await listAuditEntries(handle.db, {
      entityType: 'pricing_rule',
      entityId: 'r1',
    });
    expect(entries.map((e) => e.action)).toEqual(['pricing_rule.updated', 'pricing_rule.created']);
    expect(entries[0]).toMatchObject({
      before: { markup: '0.02' },
      after: { markup: '0.03' },
      correlationId: 'req-1',
    });
  });

  it('orders entries written in one transaction newest first', async () => {
    for (let i = 0; i < 10; i++) {
      await truncateAll(handle.db);
      await handle.db.transaction(async (tx) => {
        await recordAudit(tx, {
          actorType: 'system',
          action: 'first',
          entityType: 't',
          entityId: 'e',
        });
        await recordAudit(tx, {
          actorType: 'system',
          action: 'second',
          entityType: 't',
          entityId: 'e',
        });
      });
      const entries = await listAuditEntries(handle.db, { entityType: 't', entityId: 'e' });
      expect(entries.map((e) => e.action)).toEqual(['second', 'first']);
    }
  });
});
