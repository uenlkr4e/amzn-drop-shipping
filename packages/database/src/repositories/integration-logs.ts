import type { Database } from '../client';
import { integrationLogs } from '../schema';

export interface IntegrationCallMeta {
  provider: string;
  operation: string;
  accountRef?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

export interface IntegrationCallRecord extends IntegrationCallMeta {
  status: 'success' | 'error' | 'throttled';
  durationMs: number;
  httpStatus?: number;
  errorMessage?: string;
}

export async function recordIntegrationCall(
  db: Database,
  record: IntegrationCallRecord,
): Promise<void> {
  await db.insert(integrationLogs).values({
    provider: record.provider,
    operation: record.operation,
    accountRef: record.accountRef ?? null,
    status: record.status,
    httpStatus: record.httpStatus ?? null,
    durationMs: record.durationMs,
    errorMessage: record.errorMessage ?? null,
    correlationId: record.correlationId ?? null,
    details: record.details ?? null,
  });
}

const MAX_ERROR_MESSAGE_LENGTH = 2000;

function toStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) return Number(value);
  return undefined;
}

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, statusCode, response } = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown; statusCode?: unknown } | null;
  };
  return (
    toStatus(status) ??
    toStatus(statusCode) ??
    toStatus(response?.status) ??
    toStatus(response?.statusCode)
  );
}

/** Logging must never change the outcome of the call being logged. */
async function safeRecord(db: Database, record: IntegrationCallRecord): Promise<void> {
  try {
    await recordIntegrationCall(db, record);
  } catch (error) {
    console.error('Failed to record integration call', error);
  }
}

/** Times an external call, records the outcome, and returns or rethrows the call's result. */
export async function withIntegrationLog<T>(
  db: Database,
  meta: IntegrationCallMeta,
  call: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  let result: T;
  try {
    result = await call();
  } catch (error) {
    const httpStatus = httpStatusOf(error);
    const message = error instanceof Error ? error.message : String(error);
    await safeRecord(db, {
      ...meta,
      status: httpStatus === 429 ? 'throttled' : 'error',
      httpStatus,
      errorMessage: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
      durationMs: Math.round(performance.now() - started),
    });
    throw error;
  }
  await safeRecord(db, {
    ...meta,
    status: 'success',
    durationMs: Math.round(performance.now() - started),
  });
  return result;
}
