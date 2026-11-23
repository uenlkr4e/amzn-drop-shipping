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
import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { API_ENV } from '../config/api-config.module';
import type { OpsStatusDto } from './ops.dto';

const STALE_AFTER_MS = WORKER_HEARTBEAT_INTERVAL_MS * 3;
const QUEUE_STATUS_TIMEOUT_MS = 3000;

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
        // Fail fast: HTTP handlers must not queue commands while Redis is down (workers keep null).
        connection: {
          ...redisOptionsFromUrl(this.env.REDIS_URL),
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        },
        prefix: BULL_PREFIX,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async status(now: Date = new Date()): Promise<OpsStatusDto> {
    const queues = await this.queueStatuses();
    const workers = (await listHeartbeats(this.db)).map((row) => ({
      workerGroup: row.workerGroup,
      instanceId: row.instanceId,
      lastSeenAt: row.lastSeenAt.toISOString(),
      stale: now.getTime() - row.lastSeenAt.getTime() > STALE_AFTER_MS,
    }));
    return { queues, workers };
  }

  private async queueStatuses(): Promise<OpsStatusDto['queues']> {
    const unavailable = () =>
      new ServiceUnavailableException({
        code: 'QUEUE_STATUS_UNAVAILABLE',
        message: 'Queue status unavailable',
      });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(unavailable()), QUEUE_STATUS_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.fetchQueueCounts(), timeout]);
    } catch (error) {
      throw error instanceof ServiceUnavailableException ? error : unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  private fetchQueueCounts(): Promise<OpsStatusDto['queues']> {
    return Promise.all(
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
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
