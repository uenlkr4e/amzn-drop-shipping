import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createLoggerOptions } from './logger';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, stream };
}

describe('createLoggerOptions', () => {
  it('tags every line with service and environment', () => {
    const { lines, stream } = capture();
    const logger = pino(
      createLoggerOptions({ service: 'api', level: 'info', appEnv: 'test' }),
      stream,
    );
    logger.info('hello');
    expect(lines[0]).toMatchObject({ service: 'api', env: 'test', msg: 'hello' });
  });

  it('redacts credentials, cookies and tokens', () => {
    const { lines, stream } = capture();
    const logger = pino(
      createLoggerOptions({ service: 'api', level: 'info', appEnv: 'test' }),
      stream,
    );
    logger.info(
      {
        req: { headers: { authorization: 'Bearer abc', cookie: 'session=abc' } },
        credentials: {
          password: 'SECRET-PASSWORD-123',
          accessToken: 'SECRET-ACCESS-123',
          refreshToken: 'SECRET-REFRESH-123',
          secret: 'SECRET-SECRET-123',
        },
      },
      'request',
    );
    const serialized = JSON.stringify(lines[0]);
    for (const secret of [
      'Bearer abc',
      'session=abc',
      'SECRET-PASSWORD-123',
      'SECRET-ACCESS-123',
      'SECRET-REFRESH-123',
      'SECRET-SECRET-123',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('[REDACTED]');
  });

  it('redacts top-level, header and provider-error secrets', () => {
    const { lines, stream } = capture();
    const logger = pino(
      createLoggerOptions({ service: 'api', level: 'info', appEnv: 'test' }),
      stream,
    );
    logger.info(
      {
        password: 'SECRET-PASSWORD-123',
        token: 'SECRET-TOKEN-123',
        apiKey: 'SECRET-APIKEY-123',
        headers: { authorization: 'SECRET-AUTH-HEADER', cookie: 'SECRET-COOKIE-HEADER' },
        err: {
          config: {
            headers: { authorization: 'SECRET-ERR-AUTH', 'x-amz-access-token': 'SECRET-AMZ-TOKEN' },
          },
          response: { config: { headers: { authorization: 'SECRET-ERR-RESP-AUTH' } } },
        },
        res: { headers: { 'set-cookie': 'SECRET-SET-COOKIE' } },
        orderId: 'ORDER-1',
      },
      'leak check',
    );
    const serialized = JSON.stringify(lines[0]);
    expect(serialized).not.toContain('SECRET-');
    expect(serialized).toContain('[REDACTED]');
    expect(lines[0]).toMatchObject({ orderId: 'ORDER-1' });
  });
});
