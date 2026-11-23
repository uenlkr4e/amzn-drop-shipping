import { type Database, recordHeartbeat } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import { WORKER_HEARTBEAT_INTERVAL_MS } from '@dropship/queue';
import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  type Logger,
  WORKER_IDENTITY,
  WORKER_LOGGER,
  WORKER_REDIS,
  type WorkerIdentity,
} from '../worker-config.module';

export const REDIS_PING_TIMEOUT_MS = 2_000;

/**
 * Each process writes its own heartbeat so the dashboard shows every running instance.
 * A worker that cannot reach Redis cannot process jobs, so it stops heartbeating and shows as stale.
 */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WORKER_IDENTITY) private readonly identity: WorkerIdentity,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
    @Inject(WORKER_REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => {
      this.beat().catch((err) => this.logger.error({ err }, 'heartbeat failed'));
    }, WORKER_HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  async beat(): Promise<void> {
    try {
      await this.pingRedis();
    } catch (err) {
      this.logger.warn({ err }, 'skipping heartbeat: Redis unavailable');
      return;
    }
    await Promise.all(
      this.identity.groups.map((workerGroup) =>
        recordHeartbeat(this.db, {
          workerGroup,
          instanceId: this.identity.instanceId,
          startedAt: this.identity.startedAt,
        }),
      ),
    );
  }

  /** Stop beating before the DB pool and Redis client close (they close in onApplicationShutdown). */
  beforeApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async pingRedis(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    const ping = async () => {
      // lazyConnect: the first beat opens the connection; with the offline queue disabled a
      // command on a non-ready client fails immediately instead of waiting.
      if (this.redis.status === 'wait') await this.redis.connect();
      await this.redis.ping();
    };
    try {
      await Promise.race([
        ping(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Redis ping timed out after ${REDIS_PING_TIMEOUT_MS}ms`)),
            REDIS_PING_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}
