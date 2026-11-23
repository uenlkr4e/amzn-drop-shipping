import type { WorkerEnv } from '@dropship/config';
import { DatabaseModule } from '@dropship/nest-common';
import { BULL_PREFIX, redisOptionsFromUrl } from '@dropship/queue';
import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { HeartbeatModule } from './heartbeat/heartbeat.module';
import { SystemModule } from './system/system.module';
import { WorkerConfigModule } from './worker-config.module';

/** One entry per worker group. Railway services choose groups with WORKER_GROUPS. */
export const WORKER_GROUP_MODULES = {
  system: SystemModule,
} satisfies Record<string, Type<unknown>>;

export type WorkerGroup = keyof typeof WORKER_GROUP_MODULES;

export function resolveWorkerGroups(names: string[]): WorkerGroup[] {
  const known = Object.keys(WORKER_GROUP_MODULES);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown worker group(s): ${unknown.join(', ')}. Known: ${known.join(', ')}`);
  }
  return names as WorkerGroup[];
}

@Module({})
export class WorkersModule {
  static forRoot(env: WorkerEnv): DynamicModule {
    const groups = resolveWorkerGroups(env.WORKER_GROUPS);
    return {
      module: WorkersModule,
      imports: [
        SentryModule.forRoot(),
        WorkerConfigModule.forRoot(env, groups),
        DatabaseModule.forRoot(env.DATABASE_URL),
        BullModule.forRoot({ connection: redisOptionsFromUrl(env.REDIS_URL), prefix: BULL_PREFIX }),
        HeartbeatModule,
        ...groups.map((group) => WORKER_GROUP_MODULES[group]),
      ],
    };
  }
}
