import type { LoggerOptions } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/** Paths removed from every log line. Extend when a provider adds new secret fields. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.token',
  '*.apiKey',
];

export function createLoggerOptions(input: {
  service: string;
  level: LogLevel;
  appEnv: string;
}): LoggerOptions {
  return {
    level: input.level,
    base: { service: input.service, env: input.appEnv },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };
}
