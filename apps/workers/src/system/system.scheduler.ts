import { QUEUE_NAMES, SYSTEM_JOBS } from '@dropship/queue';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';

/** Upserting is idempotent, so every instance can safely register the same schedule on boot. */
@Injectable()
export class SystemScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE_NAMES.system) private readonly queue: Queue) {}

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
