import { type ApiEnv, apiEnvSchema, parseEnv } from '@dropship/config';
import { assertTestDatabaseUrl } from '@dropship/database/testing';

export function testApiEnv(overrides: Record<string, string> = {}): ApiEnv {
  return parseEnv(apiEnvSchema, {
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL),
    REDIS_URL: process.env.TEST_REDIS_URL,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123456',
    BETTER_AUTH_URL: 'http://localhost:3000',
    WEB_ORIGIN: 'http://localhost:3000',
    REQUIRE_2FA: 'false',
    ...overrides,
  });
}
