import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    actorType: text('actor_type', { enum: ['user', 'system'] }).notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    correlationId: text('correlation_id'),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_occurred_at_idx').on(t.occurredAt),
  ],
);

export const integrationLogs = pgTable(
  'integration_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    provider: text('provider').notNull(),
    operation: text('operation').notNull(),
    accountRef: text('account_ref'),
    status: text('status', { enum: ['success', 'error', 'throttled'] }).notNull(),
    httpStatus: integer('http_status'),
    durationMs: integer('duration_ms').notNull(),
    errorMessage: text('error_message'),
    correlationId: text('correlation_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (t) => [index('integration_logs_provider_idx').on(t.provider, t.occurredAt)],
);

export const workerHeartbeats = pgTable(
  'worker_heartbeats',
  {
    workerGroup: text('worker_group').notNull(),
    instanceId: text('instance_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workerGroup, t.instanceId] })],
);
