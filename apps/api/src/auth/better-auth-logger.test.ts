import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { betterAuthLogger } from './better-auth-logger';

function capture(level: pino.Level) {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, logger: pino({ level }, stream) };
}

describe('betterAuthLogger', () => {
  it('writes Better Auth messages as pino JSON lines tagged with the component', () => {
    const { lines, logger } = capture('info');
    betterAuthLogger(logger).log?.('warn', 'Rate limit exceeded', { path: '/sign-in/email' });
    expect(lines).toEqual([
      expect.objectContaining({
        level: 40,
        component: 'better-auth',
        msg: 'Rate limit exceeded',
        details: [{ path: '/sign-in/email' }],
      }),
    ]);
  });

  it('serializes errors with their stack', () => {
    const { lines, logger } = capture('info');
    betterAuthLogger(logger).log?.('error', 'adapter failed', new Error('db down'));
    expect(lines[0]).toMatchObject({
      level: 50,
      msg: 'adapter failed',
      err: { message: 'db down' },
    });
  });

  it('follows the pino level so debug output is only requested when enabled', () => {
    expect(betterAuthLogger(capture('debug').logger).level).toBe('debug');
    expect(betterAuthLogger(capture('info').logger).level).toBe('info');
    expect(betterAuthLogger(capture('error').logger).level).toBe('error');
  });
});
