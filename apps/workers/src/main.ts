import './instrument';
import 'reflect-metadata';
import { parseEnv, workerEnvSchema } from '@dropship/config';
import { createLoggerOptions } from '@dropship/observability';
import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import {
  type Logger,
  WORKER_IDENTITY,
  WORKER_LOGGER,
  type WorkerIdentity,
} from './worker-config.module';
import { WorkersModule } from './workers.module';

/** Boot blocks on Redis (queue scheduler registration); fail so Railway restarts the service. */
const BOOT_TIMEOUT_MS = 60_000;

async function bootstrap() {
  const env = parseEnv(workerEnvSchema);
  const bootTimer = setTimeout(() => {
    pino(
      createLoggerOptions({ service: 'workers', level: env.LOG_LEVEL, appEnv: env.APP_ENV }),
    ).error(
      { timeoutMs: BOOT_TIMEOUT_MS },
      'worker did not finish starting in time (is Redis reachable?); exiting',
    );
    process.exit(1);
  }, BOOT_TIMEOUT_MS);
  // createApplicationContext runs init() (and its bootstrap hooks) before resolving.
  const app = await NestFactory.createApplicationContext(WorkersModule.forRoot(env));
  clearTimeout(bootTimer);
  // SIGTERM from Railway closes BullMQ workers (finishing active jobs) and the DB pool.
  app.enableShutdownHooks();
  const identity = app.get<WorkerIdentity>(WORKER_IDENTITY);
  app
    .get<Logger>(WORKER_LOGGER)
    .info({ instanceId: identity.instanceId, groups: identity.groups }, 'worker started');
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
