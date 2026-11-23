import { hostname } from 'node:os';
import type { WorkerEnv } from '@dropship/config';
import { createLoggerOptions } from '@dropship/observability';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import pino, { type Logger } from 'pino';

export const WORKER_ENV = Symbol('WORKER_ENV');
export const WORKER_IDENTITY = Symbol('WORKER_IDENTITY');
export const WORKER_LOGGER = Symbol('WORKER_LOGGER');

export interface WorkerIdentity {
  instanceId: string;
  startedAt: Date;
  groups: string[];
}

export type { Logger };

@Global()
@Module({})
export class WorkerConfigModule {
  static forRoot(env: WorkerEnv, groups: string[]): DynamicModule {
    const identity: WorkerIdentity = {
      instanceId: `${process.env.RAILWAY_REPLICA_ID ?? hostname()}-${process.pid}`,
      startedAt: new Date(),
      groups,
    };
    const logger = pino(
      createLoggerOptions({ service: 'workers', level: env.LOG_LEVEL, appEnv: env.APP_ENV }),
    );
    return {
      module: WorkerConfigModule,
      providers: [
        { provide: WORKER_ENV, useValue: env },
        { provide: WORKER_IDENTITY, useValue: identity },
        { provide: WORKER_LOGGER, useValue: logger },
      ],
      exports: [WORKER_ENV, WORKER_IDENTITY, WORKER_LOGGER],
    };
  }
}
