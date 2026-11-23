import { type Database, pruneHeartbeats } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import { QUEUE_NAMES, SYSTEM_JOBS } from '@dropship/queue';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { type Job, UnrecoverableError } from 'bullmq';
import { type Logger, WORKER_LOGGER } from '../worker-config.module';

export const HEARTBEAT_RETENTION_MS = 24 * 60 * 60 * 1000;

@Processor(QUEUE_NAMES.system, { concurrency: 1 })
export class SystemProcessor extends WorkerHost {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<{ deleted: number }> {
    const log = this.logger.child({
      queue: QUEUE_NAMES.system,
      jobId: job.id,
      jobName: job.name,
      correlationId: (job.data as { correlationId?: string } | undefined)?.correlationId ?? job.id,
    });
    switch (job.name) {
      case SYSTEM_JOBS.pruneHeartbeats: {
        const cutoff = new Date(Date.now() - HEARTBEAT_RETENTION_MS);
        const deleted = await pruneHeartbeats(this.db, cutoff);
        log.info({ deleted }, 'pruned worker heartbeats');
        return { deleted };
      }
      default:
        // UnrecoverableError tells BullMQ not to retry.
        throw new UnrecoverableError(`Unknown system job: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error({ err: error, jobId: job?.id, jobName: job?.name }, 'system job failed');
    Sentry.captureException(error, { tags: { queue: QUEUE_NAMES.system, job: job?.name } });
  }
}
