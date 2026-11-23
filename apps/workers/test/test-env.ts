import { parseEnv, type WorkerEnv, workerEnvSchema } from '@dropship/config';
import { assertTestDatabaseUrl } from '@dropship/database/testing';

export function testWorkerEnv(): WorkerEnv {
  return parseEnv(workerEnvSchema, {
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL),
    REDIS_URL: process.env.TEST_REDIS_URL,
    WORKER_GROUPS: 'system',
  });
}
