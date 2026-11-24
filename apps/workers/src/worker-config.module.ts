import { hostname } from 'node:os';
import type { WorkerEnv } from '@dropship/config';
import { createLoggerOptions } from '@dropship/observability';
import { redisOptionsFromUrl } from '@dropship/queue';
import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import pino, { type Logger } from 'pino';

export const WORKER_ENV = Symbol('WORKER_ENV');
export const WORKER_IDENTITY = Symbol('WORKER_IDENTITY');
export const WORKER_LOGGER = Symbol('WORKER_LOGGER');
/** Small dedicated client used only to probe Redis health before each heartbeat. */
export const WORKER_REDIS = Symbol('WORKER_REDIS');

export interface WorkerIdentity {
  instanceId: string;
  startedAt: Date;
  groups: string[];
}

export type { Logger };

export function createWorkerLogger(env: WorkerEnv): Logger {
  return pino(
    createLoggerOptions({ service: 'workers', level: env.LOG_LEVEL, appEnv: env.APP_ENV }),
  );
}

@Global()
@Module({})
export class WorkerConfigModule implements OnApplicationShutdown {
  constructor(@Inject(WORKER_REDIS) private readonly redis: Redis) {}

  static forRoot(env: WorkerEnv, groups: string[]): DynamicModule {
    const identity: WorkerIdentity = {
      instanceId: `${process.env.RAILWAY_REPLICA_ID ?? hostname()}-${process.pid}`,
      startedAt: new Date(),
      groups,
    };
    const logger = createWorkerLogger(env);
    return {
      module: WorkerConfigModule,
      providers: [
        { provide: WORKER_ENV, useValue: env },
        { provide: WORKER_IDENTITY, useValue: identity },
        { provide: WORKER_LOGGER, useValue: logger },
        {
          provide: WORKER_REDIS,
          useFactory: () => {
            // No offline queue and a single retry: a ping fails fast instead of waiting for Redis.
            const redis = new Redis({
              ...redisOptionsFromUrl(env.REDIS_URL),
              lazyConnect: true,
              maxRetriesPerRequest: 1,
              enableOfflineQueue: false,
            });
            // Reconnect errors repeat every retry; the heartbeat logs the outage once per beat.
            redis.on('error', (err) => logger.debug({ err }, 'heartbeat Redis client error'));
            return redis;
          },
        },
      ],
      exports: [WORKER_ENV, WORKER_IDENTITY, WORKER_LOGGER, WORKER_REDIS],
    };
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
