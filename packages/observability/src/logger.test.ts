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
        credentials: { password: 'hunter2', accessToken: 'a', refreshToken: 'r', secret: 's' },
      },
      'request',
    );
    const serialized = JSON.stringify(lines[0]);
    for (const secret of ['Bearer abc', 'session=abc', 'hunter2', '"a"', '"r"', '"s"']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('[REDACTED]');
  });
});
