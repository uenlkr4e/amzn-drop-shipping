import type { ApiEnv } from '@dropship/config';
import { type Database, listHeartbeats } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import {
  BULL_PREFIX,
  QUEUE_NAMES,
  type QueueName,
  redisOptionsFromUrl,
  WORKER_HEARTBEAT_INTERVAL_MS,
} from '@dropship/queue';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type ConnectionOptions, Queue } from 'bullmq';
import { API_ENV } from '../config/api-config.module';
import type { OpsStatusDto } from './ops.dto';

const STALE_AFTER_MS = WORKER_HEARTBEAT_INTERVAL_MS * 3;

@Injectable()
export class OpsService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Queues are opened on first use so the API starts even when Redis is briefly unavailable. */
  private queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        // ioredis 6 RedisOptions is not structurally assignable to BullMQ 6 ConnectionOptions.
        connection: redisOptionsFromUrl(this.env.REDIS_URL) as ConnectionOptions,
        prefix: BULL_PREFIX,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async status(now: Date = new Date()): Promise<OpsStatusDto> {
    const queues = await Promise.all(
      Object.values(QUEUE_NAMES).map(async (name) => {
        const counts = await this.queue(name).getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
        );
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
        };
      }),
    );
    const workers = (await listHeartbeats(this.db)).map((row) => ({
      workerGroup: row.workerGroup,
      instanceId: row.instanceId,
      lastSeenAt: row.lastSeenAt.toISOString(),
      stale: now.getTime() - row.lastSeenAt.getTime() > STALE_AFTER_MS,
    }));
    return { queues, workers };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
