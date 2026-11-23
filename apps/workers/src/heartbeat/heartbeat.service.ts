import { type Database, recordHeartbeat } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import { WORKER_HEARTBEAT_INTERVAL_MS } from '@dropship/queue';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  type Logger,
  WORKER_IDENTITY,
  WORKER_LOGGER,
  type WorkerIdentity,
} from '../worker-config.module';

/** Each process writes its own heartbeat so the dashboard shows every running instance. */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WORKER_IDENTITY) private readonly identity: WorkerIdentity,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => {
      this.beat().catch((err) => this.logger.error({ err }, 'heartbeat failed'));
    }, WORKER_HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  async beat(): Promise<void> {
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

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
