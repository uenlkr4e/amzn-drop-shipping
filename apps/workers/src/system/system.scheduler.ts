import { QUEUE_NAMES, SYSTEM_JOBS } from '@dropship/queue';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { type Logger, WORKER_LOGGER } from '../worker-config.module';

/** Upserting is idempotent, so every instance can safely register the same schedule on boot. */
@Injectable()
export class SystemScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE_NAMES.system) private readonly queue: Queue,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {
    // Registered in the constructor so connection errors are logged even while boot is stuck.
    this.queue.on('error', (err) => {
      this.logger.error({ err, queue: QUEUE_NAMES.system }, 'system queue error');
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SYSTEM_JOBS.pruneHeartbeats,
      { every: 60 * 60 * 1000 },
      {
        name: SYSTEM_JOBS.pruneHeartbeats,
        data: {},
        opts: { removeOnComplete: 100, removeOnFail: 500 },
      },
    );
  }
}
