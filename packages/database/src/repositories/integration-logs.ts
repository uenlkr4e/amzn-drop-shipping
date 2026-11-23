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

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  if (typeof status === 'number') return status;
  if (typeof statusCode === 'number') return statusCode;
  return undefined;
}

/** Times an external call, records the outcome, and returns or rethrows the call's result. */
export async function withIntegrationLog<T>(
  db: Database,
  meta: IntegrationCallMeta,
  call: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    const result = await call();
    await recordIntegrationCall(db, {
      ...meta,
      status: 'success',
      durationMs: Math.round(performance.now() - started),
    });
    return result;
  } catch (error) {
    const httpStatus = httpStatusOf(error);
    await recordIntegrationCall(db, {
      ...meta,
      status: httpStatus === 429 ? 'throttled' : 'error',
      httpStatus,
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - started),
    });
    throw error;
  }
}
