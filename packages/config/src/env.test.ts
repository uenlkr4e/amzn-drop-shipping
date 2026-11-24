import { describe, expect, it } from 'vitest';
import { apiEnvSchema, EnvValidationError, parseEnv, workerEnvSchema } from './env';

const validApi = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:5173',
  WEB_ORIGIN: 'http://localhost:5173',
};

describe('parseEnv(apiEnvSchema)', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = parseEnv(apiEnvSchema, validApi);
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.REQUIRE_2FA).toBe(true);
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('parses REQUIRE_2FA=false as boolean false', () => {
    const env = parseEnv(apiEnvSchema, { ...validApi, REQUIRE_2FA: 'false' });
    expect(env.REQUIRE_2FA).toBe(false);
  });

  it('treats an empty SENTRY_DSN as unset', () => {
    const env = parseEnv(apiEnvSchema, { ...validApi, SENTRY_DSN: '' });
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('treats empty strings as unset so defaults apply', () => {
    const env = parseEnv(apiEnvSchema, {
      ...validApi,
      PORT: '',
      APP_ENV: '',
      LOG_LEVEL: '',
      REQUIRE_2FA: '',
    });
    expect(env.PORT).toBe(3000);
    expect(env.APP_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.REQUIRE_2FA).toBe(true);
  });

  it('names every missing or invalid variable in one error', () => {
    const { DATABASE_URL: _db, ...rest } = validApi;
    const call = () => parseEnv(apiEnvSchema, { ...rest, BETTER_AUTH_SECRET: 'short' });
    expect(call).toThrow(EnvValidationError);
    expect(call).toThrow(/DATABASE_URL/);
    expect(call).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('refuses REQUIRE_2FA=false in production', () => {
    const call = () =>
      parseEnv(apiEnvSchema, { ...validApi, APP_ENV: 'production', REQUIRE_2FA: 'false' });
    expect(call).toThrow(/REQUIRE_2FA/);
  });
});

describe('parseEnv(workerEnvSchema)', () => {
  it('splits WORKER_GROUPS into a trimmed list', () => {
    const env = parseEnv(workerEnvSchema, {
      DATABASE_URL: validApi.DATABASE_URL,
      REDIS_URL: validApi.REDIS_URL,
      WORKER_GROUPS: 'system, research ,',
    });
    expect(env.WORKER_GROUPS).toEqual(['system', 'research']);
  });

  it('requires at least one worker group', () => {
    const call = () =>
      parseEnv(workerEnvSchema, {
        DATABASE_URL: validApi.DATABASE_URL,
        REDIS_URL: validApi.REDIS_URL,
        WORKER_GROUPS: ' , ',
      });
    expect(call).toThrow(/WORKER_GROUPS/);
  });
});

describe('APP_ENV in production images (NODE_ENV=production)', () => {
  const validWorker = {
    DATABASE_URL: validApi.DATABASE_URL,
    REDIS_URL: validApi.REDIS_URL,
    WORKER_GROUPS: 'system',
  };

  it.each([
    ['api', apiEnvSchema, validApi],
    ['workers', workerEnvSchema, validWorker],
  ] as const)('%s: refuses a missing APP_ENV', (_name, schema, base) => {
    const { APP_ENV: _appEnv, ...rest } = { APP_ENV: undefined, ...base };
    const call = () => parseEnv(schema, { ...rest, NODE_ENV: 'production' });
    expect(call).toThrow(EnvValidationError);
    expect(call).toThrow(/APP_ENV/);
  });

  it.each([
    ['api', apiEnvSchema, validApi],
    ['workers', workerEnvSchema, validWorker],
  ] as const)('%s: refuses APP_ENV=development', (_name, schema, base) => {
    const call = () =>
      parseEnv(schema, { ...base, APP_ENV: 'development', NODE_ENV: 'production' });
    expect(call).toThrow(/APP_ENV/);
  });

  it.each([
    ['api', apiEnvSchema, validApi],
    ['workers', workerEnvSchema, validWorker],
  ] as const)('%s: accepts APP_ENV=staging', (_name, schema, base) => {
    const env = parseEnv(schema, { ...base, APP_ENV: 'staging', NODE_ENV: 'production' });
    expect(env.APP_ENV).toBe('staging');
  });

  it('does not apply outside production images', () => {
    const { APP_ENV: _appEnv, ...rest } = validApi;
    expect(parseEnv(apiEnvSchema, rest).APP_ENV).toBe('development');
  });
});
