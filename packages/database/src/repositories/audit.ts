import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Database } from '../client';
import { auditLogs } from '../schema';

export interface AuditEntry {
  actorType: 'user' | 'system';
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  correlationId?: string | null;
}

export async function recordAudit(db: Database, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorType: entry.actorType,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    metadata: entry.metadata ?? null,
    correlationId: entry.correlationId ?? null,
  });
}

export async function listAuditEntries(
  db: Database,
  filter: { entityType: string; entityId?: string; limit?: number },
) {
  const conditions: SQL[] = [eq(auditLogs.entityType, filter.entityType)];
  if (filter.entityId) conditions.push(eq(auditLogs.entityId, filter.entityId));
  return db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
    .limit(filter.limit ?? 50);
}
